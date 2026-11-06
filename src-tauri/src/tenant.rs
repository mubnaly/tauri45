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

//! Multi-tenancy engine (Subsystem 2).
//!
//! The registry ships with the binary (`tenants-registry.json`), so a fresh
//! install already knows every tenant without a network round trip. Unknown
//! codes still resolve when they look like a subdomain of `allama.online`,
//! which keeps the store listing workflow (new tenant, no app update) intact.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const REGISTRY: &str = include_str!("../../tenants-registry.json");
pub const TENANT_DOMAIN: &str = "allama.online";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct TenantEntry {
    pub id: String,
    pub backend_url: String,
    #[serde(default)]
    pub company_id: Option<i64>,
    #[serde(default)]
    pub branding_api: Option<String>,
    #[serde(default)]
    pub bundle_id: Option<String>,
    #[serde(default)]
    pub local_brand_path: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Registry {
    tenants: Vec<TenantEntry>,
}

#[derive(Clone)]
pub struct TenantManager {
    root: PathBuf,
}

impl TenantManager {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            root: data_dir.join("tenants"),
        }
    }

    /// Every tenant known at build time.
    pub fn all(&self) -> Vec<TenantEntry> {
        serde_json::from_str::<Registry>(REGISTRY)
            .map(|registry| registry.tenants)
            .unwrap_or_default()
    }

    pub fn find(&self, code: &str) -> Option<TenantEntry> {
        let code = normalise(code);
        self.all().into_iter().find(|tenant| tenant.id == code)
    }

    /// Resolves a tenant code, falling back to a subdomain of `allama.online`.
    pub fn resolve(&self, code: &str) -> Option<TenantEntry> {
        if let Some(tenant) = self.find(code) {
            return Some(tenant);
        }

        let code = normalise(code);
        if !is_valid_tenant_code(&code) {
            return None;
        }

        Some(TenantEntry {
            id: code.clone(),
            backend_url: format!("https://{code}.{TENANT_DOMAIN}"),
            company_id: None,
            branding_api: Some(
                "/webservice/rest/server.php?wsfunction=local_iomad_get_company_branding&moodlewsrestformat=json"
                    .to_string(),
            ),
            bundle_id: Some(format!("com.dawwar.online.allama.{code}")),
            local_brand_path: None,
            description: None,
        })
    }

    /// Directory where downloaded tenant branding is cached.
    pub fn branding_dir(&self, tenant_id: &str) -> PathBuf {
        self.root.join(sanitise_segment(tenant_id))
    }
}

pub fn normalise(code: &str) -> String {
    code.trim().trim_start_matches("https://").trim_start_matches("http://")
        .split('.')
        .next()
        .unwrap_or_default()
        .to_lowercase()
}

pub fn is_valid_tenant_code(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= 40
        && code
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Keeps a single path segment free of traversal sequences.
pub fn sanitise_segment(value: &str) -> String {
    value
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

/// Finds the first string for any of `keys` anywhere in a JSON tree.
pub fn find_string(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    match value {
        serde_json::Value::Object(map) => {
            for (key, child) in map {
                if keys.iter().any(|candidate| candidate.eq_ignore_ascii_case(key)) {
                    if let Some(text) = child.as_str() {
                        if !text.trim().is_empty() {
                            return Some(text.trim().to_string());
                        }
                    }
                }
            }

            map.values().find_map(|child| find_string(child, keys))
        }
        serde_json::Value::Array(items) => {
            items.iter().find_map(|child| find_string(child, keys))
        }
        _ => None,
    }
}
