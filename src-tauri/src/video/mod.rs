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

//! Local streaming server for encrypted offline media (Subsystem 3).
//!
//! Binds `127.0.0.1:<random port>` and serves `GET /video/{media_id}` straight
//! out of the encrypted file, decrypting only the chunks a byte range needs.
//! The WebView therefore gets a normal HTTP URL that Plyr can seek in, while the
//! bytes on disk are never decrypted as a whole.

pub mod youtube;

use crate::db::Database;
use crate::security::crypto::Crypto;
use serde::Serialize;
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;
use tiny_http::{Header, Method, Response, Server, StatusCode};

#[derive(Clone, Debug, Serialize)]
pub struct MediaServer {
    pub port: u16,
}

struct Inner {
    db: Database,
    crypto: Crypto,
}

impl MediaServer {
    pub fn start(db: Database, crypto: Crypto) -> Result<Self, String> {
        let server = Server::http("127.0.0.1:0").map_err(|e| format!("bind media server: {e}"))?;
        let port = server
            .server_addr()
            .to_ip()
            .ok_or("media server did not bind to an IP address")?
            .port();

        let inner = Arc::new(Inner { db, crypto });

        std::thread::Builder::new()
            .name("allama-media".to_string())
            .spawn(move || serve(server, inner))
            .map_err(|e| format!("spawn media server: {e}"))?;

        Ok(Self { port })
    }

    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    pub fn stream_url(&self, media_id: &str) -> String {
        format!("{}/video/{}", self.base_url(), media_id)
    }
}

fn serve(server: Server, inner: Arc<Inner>) {
    for request in server.incoming_requests() {
        let method = request.method().clone();
        let url = request.url().to_string();

        if method == Method::Options {
            let mut response = Response::empty(StatusCode(204));
            add_cors(&mut response);
            let _ = request.respond(response);
            continue;
        }

        if method != Method::Get && method != Method::Head {
            let response = Response::from_string("method not allowed").with_status_code(405);
            let _ = request.respond(response);
            continue;
        }

        match url.strip_prefix("/video/") {
            Some(id) => {
                let id = id.split('?').next().unwrap_or(id).to_string();
                if let Err(error) = serve_media(&inner, request, &id) {
                    log::warn!("media stream failed: {error}");
                }
            }
            None => {
                let response = Response::from_string("not found").with_status_code(404);
                let _ = request.respond(response);
            }
        }
    }
}

fn serve_media(inner: &Inner, request: tiny_http::Request, id: &str) -> Result<(), String> {
    let row = inner.db.query_one(
        "SELECT local_path, encrypted, title FROM mdl_media_files WHERE id = ?1",
        &[json!(id)],
    )?;

    let Some(row) = row else {
        let _ = request.respond(Response::from_string("unknown media").with_status_code(404));
        return Ok(());
    };

    let path = PathBuf::from(row.get("local_path").and_then(|v| v.as_str()).unwrap_or_default());
    if !path.exists() {
        let _ = request.respond(Response::from_string("missing file").with_status_code(410));
        return Ok(());
    }

    let encrypted = row.get("encrypted").and_then(|v| v.as_i64()).unwrap_or(1) == 1;
    let mime = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .to_string();

    let total = if encrypted {
        inner.crypto.plain_size(&path)?
    } else {
        std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
    };

    let range = request
        .headers()
        .iter()
        .find(|header| header.field.as_str().as_str().eq_ignore_ascii_case("range"))
        .and_then(|header| parse_range(header.value.as_str(), total));

    let (start, len, status) = match range {
        Some((start, end)) => (start, end - start + 1, StatusCode(206)),
        None => (0, total, StatusCode(200)),
    };

    let body = if encrypted {
        inner.crypto.decrypt_range(&path, id, start, len)?
    } else {
        read_range(&path, start, len)?
    };

    let mut response = Response::from_data(body).with_status_code(status);
    add_cors(&mut response);
    let _ = response.add_header(header("Content-Type", &mime));
    let _ = response.add_header(header("Accept-Ranges", "bytes"));
    let _ = response.add_header(header("Cache-Control", "no-store"));
    let _ = response.add_header(header(
        "Content-Range",
        &format!("bytes {start}-{}/{total}", start + len.saturating_sub(1)),
    ));
    let _ = response.add_header(header("Content-Length", &len.to_string()));

    let _ = request.respond(response);

    Ok(())
}

fn add_cors<R: std::io::Read>(response: &mut Response<R>) {
    let _ = response.add_header(header("Access-Control-Allow-Origin", "*"));
    let _ = response.add_header(header("Access-Control-Allow-Headers", "Range"));
    let _ = response.add_header(header("Access-Control-Expose-Headers", "Content-Range, Content-Length"));
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("static header")
}

/// Parses `bytes=start-end` (inclusive) into a plaintext range.
fn parse_range(value: &str, total: u64) -> Option<(u64, u64)> {
    let spec = value.trim().strip_prefix("bytes=")?;
    let (start, end) = spec.split_once('-')?;

    let start: u64 = start.trim().parse().ok()?;
    let end: u64 = if end.trim().is_empty() {
        total.saturating_sub(1)
    } else {
        end.trim().parse().ok()?
    };

    if start > end || start >= total {
        return None;
    }

    Some((start, end.min(total.saturating_sub(1))))
}

fn read_range(path: &PathBuf, start: u64, len: u64) -> Result<Vec<u8>, String> {
    use std::io::{Read, Seek, SeekFrom};

    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;

    let mut buffer = vec![0u8; len as usize];
    file.read_exact(&mut buffer).map_err(|e| e.to_string())?;

    Ok(buffer)
}
