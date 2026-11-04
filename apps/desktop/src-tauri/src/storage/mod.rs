mod sqlite;
#[cfg(test)]
mod tests;

use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlite::{Connection, Transaction};
use std::{fs, path::Path};

const VERSION: u32 = 1;
const APPLICATION_ID: &str = "1347375921"; // POS1; identifies this database, not a user.
const MIGRATION: &str = include_str!("../../migrations/0001_local_foundation.sql");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StorageError {
    Unavailable,
    Busy,
    Corrupt,
    NewerSchema,
    InvalidSchema,
    MigrationFailed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStatus {
    engine: &'static str,
    schema_version: u32,
    migration_count: u32,
    storage_id: String,
    created_at: String,
}

/// Owns no long-lived handles: each blocking operation opens, validates, and closes SQLite.
/// The path is selected by Rust, never by a frontend argument.
pub fn open_storage(path: &Path) -> Result<StorageStatus, StorageError> {
    let parent = path.parent().ok_or(StorageError::Unavailable)?;
    fs::create_dir_all(parent).map_err(|_| StorageError::Unavailable)?;
    let connection = Connection::open(path)?;
    connection.execute("PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL;")?;
    if connection.scalar("PRAGMA quick_check(1)")? != "ok" {
        return Err(StorageError::Corrupt);
    }
    let status = migrate(&connection, MIGRATION)?;
    // Change journaling only after rejecting foreign/newer/corrupt schemas.
    if connection.scalar("PRAGMA journal_mode=WAL")? != "wal" {
        return Err(StorageError::Unavailable);
    }
    Ok(status)
}

fn migrate(connection: &Connection, migration: &str) -> Result<StorageStatus, StorageError> {
    // Serializes concurrent first launches and keeps schema + journal + version atomic.
    let transaction = Transaction::begin(connection)?;
    let version: u32 = connection.scalar("PRAGMA user_version")?
        .parse().map_err(|_| StorageError::InvalidSchema)?;
    if version > VERSION { return Err(StorageError::NewerSchema); }
    let checksum = format!("{:x}", Sha256::digest(migration.replace("\r\n", "\n").as_bytes()));
    if version == 0 {
        let tables = connection.scalar("SELECT count(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")?;
        if tables != "0" || connection.scalar("PRAGMA application_id")? != "0" {
            return Err(StorageError::InvalidSchema);
        }
        connection.execute(migration).map_err(|_| StorageError::MigrationFailed)?;
        // All interpolated values are compile-time constants or SHA-256 hex, never user input.
        connection.execute(&format!(
            "INSERT INTO schema_migrations(version,name,checksum) VALUES (1,'local_foundation','{checksum}');
             PRAGMA application_id={APPLICATION_ID}; PRAGMA user_version=1;"
        )).map_err(|_| StorageError::MigrationFailed)?;
    }
    let status = validate(connection, &checksum)?;
    transaction.commit()?;
    Ok(status)
}

fn validate(connection: &Connection, checksum: &str) -> Result<StorageStatus, StorageError> {
    if connection.scalar("PRAGMA application_id")? != APPLICATION_ID
        || connection.scalar("SELECT count(*) FROM schema_migrations")? != "1"
        || connection.scalar("SELECT name FROM schema_migrations WHERE version=1")? != "local_foundation"
        || connection.scalar("SELECT checksum FROM schema_migrations WHERE version=1")? != checksum
        || connection.scalar("SELECT count(*) FROM local_metadata")? != "1"
    { return Err(StorageError::InvalidSchema); }
    let storage_id = connection.scalar("SELECT storage_id FROM local_metadata WHERE id=1")?;
    let created_at = connection.scalar("SELECT created_at FROM local_metadata WHERE id=1")?;
    if storage_id.len() != 32 || !storage_id.bytes().all(|byte| byte.is_ascii_hexdigit()) || created_at.is_empty() {
        return Err(StorageError::InvalidSchema);
    }
    Ok(StorageStatus { engine: "sqlite", schema_version: VERSION, migration_count: 1, storage_id, created_at })
}
