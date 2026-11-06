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

//! Moodle web-service wrappers.

use serde_json::Value;

/// Flattens a JSON object into Moodle's `name[0][field]` form encoding.
pub fn flatten_params(prefix: &str, value: &Value, out: &mut Vec<(String, String)>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let name = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{prefix}[{key}]")
                };
                flatten_params(&name, child, out);
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                flatten_params(&format!("{prefix}[{index}]"), child, out);
            }
        }
        Value::Null => {}
        Value::Bool(flag) => out.push((prefix.to_string(), flag.to_string())),
        Value::Number(number) => out.push((prefix.to_string(), number.to_string())),
        Value::String(text) => out.push((prefix.to_string(), text.clone())),
    }
}

/// Builds the REST endpoint for a site.
pub fn rest_endpoint(site_url: &str) -> String {
    format!(
        "{}/webservice/rest/server.php",
        site_url.trim_end_matches('/')
    )
}

/// Calls a Moodle external function and returns its decoded payload.
///
/// Moodle signals failures with a 200 + `{exception, errorcode, message}`, so
/// the shape has to be inspected instead of relying on the status code.
pub async fn call(
    client: &reqwest::Client,
    site_url: &str,
    token: &str,
    function: &str,
    params: &Value,
) -> Result<Value, String> {
    let mut form = vec![
        ("wstoken".to_string(), token.to_string()),
        ("wsfunction".to_string(), function.to_string()),
        ("moodlewsrestformat".to_string(), "json".to_string()),
    ];
    flatten_params("", params, &mut form);

    let response = client
        .post(rest_endpoint(site_url))
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("{function}: {e}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("{function}: read body: {e}"))?;

    if !status.is_success() {
        return Err(format!("{function}: HTTP {status}"));
    }

    let value: Value = serde_json::from_str(&body)
        .map_err(|e| format!("{function}: invalid JSON ({e}): {body}"))?;

    if let Some(error) = value.get("exception").and_then(Value::as_str) {
        let code = value
            .get("errorcode")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        return Err(format!("{function}: {code}: {error}"));
    }

    Ok(value)
}

/// Whether the site exposes a function, from `core_webservice_get_site_info`.
pub fn ws_available(functions: &Value, function: &str) -> bool {
    functions
        .as_array()
        .map(|list| {
            list.iter().any(|entry| {
                entry.get("name").and_then(Value::as_str) == Some(function)
            })
        })
        .unwrap_or(false)
}
