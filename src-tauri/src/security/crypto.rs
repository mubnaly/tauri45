// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

//! Transparent AES-256-GCM encryption for offline media and exam payloads
//! (Subsystem 4).
//!
//! File layout:
//!
//! ```text
//! "ALMA1" | chunk_size: u32 LE | (nonce: 12 bytes | ciphertext+tag)*
//! ```
//!
//! Every chunk is an independent AEAD record, so the local streaming server can
//! seek to a chunk and decrypt only what a `Range` request asks for, without
//! decrypting (or buffering) the whole file.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::Arc;

pub const MAGIC: &[u8; 5] = b"ALMA1";
pub const CHUNK_SIZE: u32 = 256 * 1024;
const HEADER_LEN: u64 = 9;
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;

#[derive(Clone)]
pub struct Crypto {
    master: Arc<[u8; 32]>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct EncryptReport {
    pub plain_bytes: u64,
    pub chunks: u64,
    pub encrypted_bytes: u64,
}

impl Crypto {
    /// Loads (or creates) the device master key in `<app_data>/keys/master.key`.
    pub fn load_or_create(dir: &Path) -> Result<Self, String> {
        fs::create_dir_all(dir).map_err(|e| format!("create key dir: {e}"))?;
        let path = dir.join("master.key");
        let mut master = [0u8; 32];

        if path.exists() {
            let bytes = fs::read(&path).map_err(|e| format!("read master key: {e}"))?;
            if bytes.len() != master.len() {
                return Err("master.key is corrupt (expected 32 bytes)".to_string());
            }
            master.copy_from_slice(&bytes);
        } else {
            rand::thread_rng().fill_bytes(&mut master);

            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|e| format!("create master key: {e}"))?;
            file.write_all(&master)
                .map_err(|e| format!("write master key: {e}"))?;
            file.sync_all().map_err(|e| format!("flush master key: {e}"))?;

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
                    .map_err(|e| format!("restrict master key permissions: {e}"))?;
            }
        }

        Ok(Self {
            master: Arc::new(master),
        })
    }

    /// Per-file key: HMAC-SHA256(master, "allama-file-key:" + file_id).
    fn file_key(&self, file_id: &str) -> Result<[u8; 32], String> {
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(self.master.as_ref())
            .map_err(|e| format!("derive file key: {e}"))?;
        mac.update(b"allama-file-key:");
        mac.update(file_id.as_bytes());

        let mut key = [0u8; 32];
        key.copy_from_slice(&mac.finalize().into_bytes());

        Ok(key)
    }

    fn cipher(&self, file_id: &str) -> Result<Aes256Gcm, String> {
        let key = self.file_key(file_id)?;
        Aes256Gcm::new_from_slice(&key).map_err(|e| format!("init cipher: {e}"))
    }

    /// Deterministic per-chunk nonce: 8 bytes of the file-id digest + chunk index.
    fn nonce_for(&self, file_id: &str, index: u64) -> [u8; NONCE_LEN] {
        let digest = Sha256::digest(file_id.as_bytes());
        let mut nonce = [0u8; NONCE_LEN];
        nonce[..8].copy_from_slice(&digest[..8]);
        nonce[8..].copy_from_slice(&(index as u32).to_le_bytes());

        nonce
    }

    /// Encrypts `input` into `output` using the chunked format above.
    pub fn encrypt_file(&self, input: &Path, output: &Path, file_id: &str) -> Result<EncryptReport, String> {
        let cipher = self.cipher(file_id)?;
        let mut reader = File::open(input).map_err(|e| format!("open {input:?}: {e}"))?;

        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create {parent:?}: {e}"))?;
        }
        let mut writer = File::create(output).map_err(|e| format!("create {output:?}: {e}"))?;

        writer.write_all(MAGIC).map_err(|e| e.to_string())?;
        writer
            .write_all(&CHUNK_SIZE.to_le_bytes())
            .map_err(|e| e.to_string())?;

        let mut buffer = vec![0u8; CHUNK_SIZE as usize];
        let mut index: u64 = 0;
        let mut plain_bytes: u64 = 0;

        loop {
            let filled = read_full(&mut reader, &mut buffer)?;
            if filled == 0 {
                break;
            }

            let nonce = self.nonce_for(file_id, index);
            let ciphertext = cipher
                .encrypt(Nonce::from_slice(&nonce), &buffer[..filled])
                .map_err(|_| format!("encrypt chunk {index}"))?;

            writer.write_all(&nonce).map_err(|e| e.to_string())?;
            writer.write_all(&ciphertext).map_err(|e| e.to_string())?;

            plain_bytes += filled as u64;
            index += 1;
        }

        writer.flush().map_err(|e| e.to_string())?;
        let encrypted_bytes = writer.metadata().map(|m| m.len()).unwrap_or(0);

        Ok(EncryptReport {
            plain_bytes,
            chunks: index,
            encrypted_bytes,
        })
    }

    /// Decrypts a whole file into `output` (used when exporting/shareing).
    pub fn decrypt_file(&self, input: &Path, output: &Path, file_id: &str) -> Result<u64, String> {
        let plain_bytes = self.plain_size(input)?;
        let data = self.decrypt_range(input, file_id, 0, plain_bytes)?;

        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create {parent:?}: {e}"))?;
        }
        File::create(output)
            .and_then(|mut file| file.write_all(&data))
            .map_err(|e| format!("write {output:?}: {e}"))?;

        Ok(plain_bytes)
    }

    /// Decrypts exactly the requested plaintext byte range.
    pub fn decrypt_range(&self, input: &Path, file_id: &str, start: u64, len: u64) -> Result<Vec<u8>, String> {
        let cipher = self.cipher(file_id)?;
        let mut file = File::open(input).map_err(|e| format!("open {input:?}: {e}"))?;
        let total_len = file.metadata().map_err(|e| e.to_string())?.len();
        let chunk_size = read_header(&mut file, total_len)?;

        if len == 0 {
            return Ok(Vec::new());
        }

        let plain_total = self.plain_size(input)?;
        let start = start.min(plain_total);
        let end = (start + len).min(plain_total);
        let mut output = Vec::with_capacity((end - start) as usize);

        let first_chunk = start / chunk_size;
        let last_chunk = (end - 1) / chunk_size;
        let record_len = NONCE_LEN as u64 + chunk_size + TAG_LEN as u64;

        for index in first_chunk..=last_chunk {
            let offset = HEADER_LEN + index * record_len;
            if offset + NONCE_LEN as u64 >= total_len {
                break;
            }

            file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
            let mut nonce = [0u8; NONCE_LEN];
            file.read_exact(&mut nonce).map_err(|e| e.to_string())?;

            let available = total_len - offset - NONCE_LEN as u64;
            let ciphertext_len = available.min(chunk_size + TAG_LEN as u64) as usize;
            let mut ciphertext = vec![0u8; ciphertext_len];
            file.read_exact(&mut ciphertext).map_err(|e| e.to_string())?;

            let plaintext = cipher
                .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
                .map_err(|_| format!("decrypt chunk {index} (wrong key or corrupted file)"))?;

            let chunk_start = index * chunk_size;
            let from = start.saturating_sub(chunk_start);
            let to = (end - chunk_start).min(plaintext.len() as u64);
            if from < to {
                output.extend_from_slice(&plaintext[from as usize..to as usize]);
            }
        }

        Ok(output)
    }

    /// Total plaintext size of an encrypted file, derived from its record layout.
    pub fn plain_size(&self, input: &Path) -> Result<u64, String> {
        let mut file = File::open(input).map_err(|e| format!("open {input:?}: {e}"))?;
        let total_len = file.metadata().map_err(|e| e.to_string())?.len();
        let chunk_size = read_header(&mut file, total_len)?;

        let mut offset = HEADER_LEN;
        let mut plain = 0u64;

        while offset + NONCE_LEN as u64 <= total_len {
            file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
            let mut nonce = [0u8; NONCE_LEN];
            file.read_exact(&mut nonce).map_err(|e| e.to_string())?;

            let available = total_len - offset - NONCE_LEN as u64;
            let ciphertext_len = available.min(chunk_size + TAG_LEN as u64);
            if ciphertext_len <= TAG_LEN as u64 {
                break;
            }

            plain += ciphertext_len - TAG_LEN as u64;
            offset += NONCE_LEN as u64 + ciphertext_len;
        }

        Ok(plain)
    }

    /// Short fingerprint of the master key, surfaced in diagnostics only.
    pub fn key_fingerprint(&self) -> String {
        let digest = Sha256::digest(self.master.as_ref());
        hex::encode(&digest[..6])
    }
}

fn read_header(file: &mut File, total_len: u64) -> Result<u64, String> {
    if total_len < HEADER_LEN {
        return Err("file too small to be an Allama encrypted media file".to_string());
    }

    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut header = [0u8; HEADER_LEN as usize];
    file.read_exact(&mut header).map_err(|e| e.to_string())?;

    if &header[..5] != MAGIC {
        return Err("missing ALMA1 magic (file is not encrypted by this app)".to_string());
    }

    let chunk_size = u32::from_le_bytes([header[5], header[6], header[7], header[8]]) as u64;
    if chunk_size == 0 {
        return Err("invalid chunk size in encrypted file header".to_string());
    }

    Ok(chunk_size)
}

fn read_full(reader: &mut File, buffer: &mut [u8]) -> Result<usize, String> {
    let mut filled = 0;
    while filled < buffer.len() {
        let read = reader.read(&mut buffer[filled..]).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        filled += read;
    }

    Ok(filled)
}
