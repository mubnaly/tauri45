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

//! Native HTTP layer (Subsystem 2 + 3).
//!
//! All Moodle web-service traffic goes through Rust's `reqwest` client, so the
//! WebView never issues cross-origin requests, never hits CORS preflights and
//! never exposes the user's web-service token to JavaScript.

pub mod api;

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT};
use std::path::Path;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

const APP_USER_AGENT: &str = concat!("AllamaTauri/", env!("CARGO_PKG_VERSION"));

#[derive(Clone)]
pub struct HttpClient {
    client: reqwest::Client,
}

impl HttpClient {
    pub fn new() -> Result<Self, String> {
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static(APP_USER_AGENT));

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            .pool_idle_timeout(Duration::from_secs(60))
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .map_err(|e| format!("build http client: {e}"))?;

        Ok(Self { client })
    }

    pub fn client(&self) -> &reqwest::Client {
        &self.client
    }

    /// POSTs a form and parses the JSON response.
    pub async fn post_form_json(
        &self,
        url: &str,
        form: &[(String, String)],
    ) -> Result<serde_json::Value, String> {
        let response = self
            .client
            .post(url)
            .form(form)
            .send()
            .await
            .map_err(|e| format!("POST {url}: {e}"))?;

        let status = response.status();
        let body = response.text().await.map_err(|e| format!("read {url}: {e}"))?;

        if !status.is_success() {
            return Err(format!("POST {url} -> HTTP {status}: {}", truncate(&body)));
        }

        serde_json::from_str(&body).map_err(|e| format!("parse {url}: {e}: {}", truncate(&body)))
    }

    /// Streams a remote file to disk, returning the number of bytes written.
    pub async fn download(&self, url: &str, destination: &Path, token: Option<&str>) -> Result<u64, String> {
        if let Some(parent) = destination.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("create {parent:?}: {e}"))?;
        }

        let mut request = self.client.get(url);
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }

        let response = request
            .send()
            .await
            .map_err(|e| format!("GET {url}: {e}"))?;

        if !response.status().is_success() {
            return Err(format!("GET {url} -> HTTP {}", response.status()));
        }

        let mut file = tokio::fs::File::create(destination)
            .await
            .map_err(|e| format!("create {destination:?}: {e}"))?;

        let mut written = 0u64;
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("read stream {url}: {e}"))?;
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("write {destination:?}: {e}"))?;
            written += chunk.len() as u64;
        }

        file.flush().await.map_err(|e| e.to_string())?;

        Ok(written)
    }
}

fn truncate(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.chars().count() <= 300 {
        trimmed.to_string()
    } else {
        format!("{}…", trimmed.chars().take(300).collect::<String>())
    }
}
