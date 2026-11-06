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

//! Embedded SQLite engine (Subsystem 1).
//!
//! Replaces `@capacitor-community/sqlite` + `jeep-sqlite`: one connection owned
//! by Rust, WAL journaling, and IPC commands that trade plain JSON instead of
//! serialising through a Java/JDBC bridge.

pub mod schema;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde_json::{Map, Value};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    /// Opens (or creates) `allama.db` inside the app data directory.
    pub fn open(dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(dir).map_err(|e| format!("create data dir: {e}"))?;
        let path = dir.join("allama.db");
        let conn = Connection::open(&path).map_err(|e| format!("open sqlite: {e}"))?;

        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| format!("enable WAL: {e}"))?;
        conn.pragma_update(None, "synchronous", "NORMAL")
            .map_err(|e| format!("set synchronous: {e}"))?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| format!("enable foreign keys: {e}"))?;
        conn.busy_timeout(std::time::Duration::from_millis(5_000))
            .map_err(|e| format!("set busy timeout: {e}"))?;

        let database = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        database.migrate()?;

        Ok(database)
    }

    fn migrate(&self) -> Result<(), String> {
        self.with(|conn| {
            conn.execute_batch(schema::SCHEMA)?;
            conn.execute_batch(schema::MIGRATIONS)?;
            Ok(())
        })
    }

    /// Runs a closure with exclusive access to the connection.
    pub fn with<T>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T, String> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| "sqlite connection lock poisoned".to_string())?;

        f(&guard).map_err(|e| format!("sqlite: {e}"))
    }

    /// Runs a SELECT and returns rows as JSON objects (column name -> value).
    pub fn query(&self, sql: &str, params: &[Value]) -> Result<Vec<Map<String, Value>>, String> {
        self.with(|conn| {
            let mut stmt = conn.prepare(sql)?;
            let columns: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
            let mut rows = stmt.query(params_from_iter(params.iter().map(to_sql)))?;
            let mut output = Vec::new();

            while let Some(row) = rows.next()? {
                let mut record = Map::with_capacity(columns.len());
                for (index, column) in columns.iter().enumerate() {
                    record.insert(column.clone(), from_ref(row.get_ref(index)?));
                }
                output.push(record);
            }

            Ok(output)
        })
    }

    /// Runs a single statement and returns the number of affected rows.
    pub fn execute(&self, sql: &str, params: &[Value]) -> Result<usize, String> {
        self.with(|conn| conn.execute(sql, params_from_iter(params.iter().map(to_sql))))
    }

    /// Runs several statements inside one transaction.
    pub fn batch(&self, statements: &[String]) -> Result<(), String> {
        self.with(|conn| {
            let tx = conn.unchecked_transaction()?;
            for sql in statements {
                tx.execute_batch(sql)?;
            }
            tx.commit()
        })
    }

    /// Convenience SELECT returning the first row, if any.
    pub fn query_one(&self, sql: &str, params: &[Value]) -> Result<Option<Map<String, Value>>, String> {
        Ok(self.query(sql, params)?.into_iter().next())
    }
}

/// Current UNIX timestamp in seconds — every table stores times this way.
pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn to_sql(value: &Value) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(flag) => SqlValue::Integer(i64::from(*flag)),
        Value::Number(number) => match number.as_i64() {
            Some(int) => SqlValue::Integer(int),
            None => SqlValue::Real(number.as_f64().unwrap_or_default()),
        },
        Value::String(text) => SqlValue::Text(text.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn from_ref(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(int) => Value::from(int),
        ValueRef::Real(float) => Value::from(float),
        ValueRef::Text(bytes) => Value::from(String::from_utf8_lossy(bytes).to_string()),
        ValueRef::Blob(bytes) => Value::from(hex::encode(bytes)),
    }
}
