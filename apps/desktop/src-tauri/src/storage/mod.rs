mod sqlite;
pub mod tasks;
pub mod outbox;
pub mod workspace;
pub mod goals;
#[cfg(test)]
mod tests;

use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlite::{Connection, Transaction};
use std::{fs, path::Path};

const VERSION: u32 = 8;
const APPLICATION_ID: &str = "1347375921"; // POS1; identifies this database, not a user.
const MIGRATION: &str = include_str!("../../migrations/0001_local_foundation.sql");
const TASK_MIGRATION: &str = include_str!("../../migrations/0002_local_tasks.sql");
const OUTBOX_MIGRATION: &str = include_str!("../../migrations/0003_local_outbox.sql");
const DELIVERY_MIGRATION: &str = include_str!("../../migrations/0004_outbox_delivery.sql");
const ACTION_MIGRATION: &str = include_str!("../../migrations/0005_task_actions.sql");
const WORKSPACE_MIGRATION: &str = include_str!("../../migrations/0006_workspace_entries.sql");
const TASK_PLANNING_MIGRATION: &str = include_str!("../../migrations/0007_task_planning.sql");
const GOALS_MIGRATION: &str = include_str!("../../migrations/0008_goals.sql");

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
    Ok(connect(path)?.1)
}

fn connect(path: &Path) -> Result<(Connection, StorageStatus), StorageError> {
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
    Ok((connection, status))
}

fn migrate(connection: &Connection, migration: &str) -> Result<StorageStatus, StorageError> {
    migrate_with_tasks(connection, migration, TASK_MIGRATION)
}

fn migrate_with_tasks(connection: &Connection, migration: &str, task_migration: &str) -> Result<StorageStatus, StorageError> {
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
    // Validate the old journal before applying new DDL. Never adopt a modified v1 database.
    let old_version = version.max(1);
    validate(connection, &checksum, old_version)?;
    let task_checksum = format!("{:x}", Sha256::digest(task_migration.replace("\r\n", "\n").as_bytes()));
    if old_version == 1 {
        connection.execute(task_migration).map_err(|_| StorageError::MigrationFailed)?;
        connection.execute(&format!(
            "INSERT INTO schema_migrations(version,name,checksum) VALUES (2,'local_tasks','{task_checksum}'); PRAGMA user_version=2;"
        )).map_err(|_| StorageError::MigrationFailed)?;
    }
    if connection.scalar("SELECT name FROM schema_migrations WHERE version=2")? != "local_tasks"
        || connection.scalar("SELECT checksum FROM schema_migrations WHERE version=2")? != task_checksum {
        return Err(StorageError::InvalidSchema);
    }
    // Preparing the projection also rejects missing/renamed task columns before returning ready.
    connection.query("SELECT id,project_ref,user_id,title,completed,created_at,updated_at FROM tasks LIMIT 0", &[])?;
    let outbox_checksum = format!("{:x}", Sha256::digest(OUTBOX_MIGRATION.replace("\r\n", "\n").as_bytes()));
    if old_version < 3 {
        connection.execute(OUTBOX_MIGRATION).map_err(|_| StorageError::MigrationFailed)?;
        connection.execute(&format!("INSERT INTO schema_migrations(version,name,checksum) VALUES(3,'local_outbox','{outbox_checksum}'); PRAGMA user_version=3;"))
            .map_err(|_| StorageError::MigrationFailed)?;
    }
    if connection.scalar("SELECT name FROM schema_migrations WHERE version=3")? != "local_outbox"
        || connection.scalar("SELECT checksum FROM schema_migrations WHERE version=3")? != outbox_checksum {
        return Err(StorageError::InvalidSchema);
    }
    connection.query("SELECT sequence,project_ref,user_id,operation_id,task_id,kind,expected_revision,title,state,created_at FROM task_outbox LIMIT 0", &[])?;
    let delivery_checksum = format!("{:x}", Sha256::digest(DELIVERY_MIGRATION.replace("\r\n", "\n").as_bytes()));
    if old_version < 4 {
        connection.execute(DELIVERY_MIGRATION).map_err(|_| StorageError::MigrationFailed)?;
        connection.execute(&format!("INSERT INTO schema_migrations(version,name,checksum) VALUES(4,'outbox_delivery','{delivery_checksum}'); PRAGMA user_version=4;"))
            .map_err(|_| StorageError::MigrationFailed)?;
    }
    if connection.scalar("SELECT checksum FROM schema_migrations WHERE version=4 AND name='outbox_delivery'")? != delivery_checksum { return Err(StorageError::InvalidSchema); }
    connection.query("SELECT sequence,revision,started_at FROM outbox_delivery LIMIT 0", &[])?;
    let action_checksum = format!("{:x}", Sha256::digest(ACTION_MIGRATION.replace("\r\n", "\n").as_bytes()));
    if old_version < 5 {
        connection.execute(ACTION_MIGRATION).map_err(|_| StorageError::MigrationFailed)?;
        connection.execute(&format!("INSERT INTO schema_migrations(version,name,checksum) VALUES(5,'task_actions','{action_checksum}'); PRAGMA user_version=5;"))
            .map_err(|_| StorageError::MigrationFailed)?;
    }
    if connection.scalar("SELECT checksum FROM schema_migrations WHERE version=5 AND name='task_actions'")? != action_checksum { return Err(StorageError::InvalidSchema); }
    connection.query("SELECT sequence,project_ref,user_id,task_id,operation_id,kind,expected_revision,completed,state,started,revision FROM task_action_outbox LIMIT 0", &[])?;
    let workspace_checksum = format!("{:x}", Sha256::digest(WORKSPACE_MIGRATION.replace("\r\n", "\n").as_bytes()));
    if old_version < 6 {
        connection.execute(WORKSPACE_MIGRATION).map_err(|_| StorageError::MigrationFailed)?;
        connection.execute(&format!("INSERT INTO schema_migrations(version,name,checksum) VALUES(6,'workspace_entries','{workspace_checksum}'); PRAGMA user_version=6;"))
            .map_err(|_| StorageError::MigrationFailed)?;
    }
    if connection.scalar("SELECT checksum FROM schema_migrations WHERE version=6 AND name='workspace_entries'")? != workspace_checksum { return Err(StorageError::InvalidSchema); }
    connection.query("SELECT id,project_ref,user_id,kind,title,body,state,pinned,revision,created_at,updated_at FROM workspace_entries LIMIT 0", &[])?;
    let planning_checksum = format!("{:x}", Sha256::digest(TASK_PLANNING_MIGRATION.replace("\r\n", "\n").as_bytes()));
    if old_version < 7 {
        connection.execute(TASK_PLANNING_MIGRATION).map_err(|_| StorageError::MigrationFailed)?;
        connection.execute(&format!("INSERT INTO schema_migrations(version,name,checksum) VALUES(7,'task_planning','{planning_checksum}'); PRAGMA user_version=7;"))
            .map_err(|_| StorageError::MigrationFailed)?;
    }
    if connection.scalar("SELECT checksum FROM schema_migrations WHERE version=7 AND name='task_planning'")? != planning_checksum { return Err(StorageError::InvalidSchema); }
    connection.query("SELECT task_id,project_ref,user_id,project_id,due_date,priority FROM task_attributes LIMIT 0", &[])?;
    let goals_checksum=format!("{:x}",Sha256::digest(GOALS_MIGRATION.replace("\r\n","\n").as_bytes()));
    if old_version<8 { connection.execute(GOALS_MIGRATION).map_err(|_|StorageError::MigrationFailed)?;connection.execute(&format!("INSERT INTO schema_migrations(version,name,checksum) VALUES(8,'goals','{goals_checksum}'); PRAGMA user_version=8;")).map_err(|_|StorageError::MigrationFailed)?; }
    if connection.scalar("SELECT checksum FROM schema_migrations WHERE version=8 AND name='goals'")?!=goals_checksum{return Err(StorageError::InvalidSchema)}
    connection.query("SELECT id,project_ref,user_id,title,description,state,target_date,progress,revision,created_at,updated_at FROM goals LIMIT 0",&[])?;
    let status = validate(connection, &checksum, VERSION)?;
    transaction.commit()?;
    Ok(status)
}

fn validate(connection: &Connection, checksum: &str, version: u32) -> Result<StorageStatus, StorageError> {
    if connection.scalar("PRAGMA application_id")? != APPLICATION_ID
        || connection.scalar("SELECT count(*) FROM schema_migrations")? != version.to_string()
        || connection.scalar("SELECT name FROM schema_migrations WHERE version=1")? != "local_foundation"
        || connection.scalar("SELECT checksum FROM schema_migrations WHERE version=1")? != checksum
        || connection.scalar("SELECT count(*) FROM local_metadata")? != "1"
    { return Err(StorageError::InvalidSchema); }
    let storage_id = connection.scalar("SELECT storage_id FROM local_metadata WHERE id=1")?;
    let created_at = connection.scalar("SELECT created_at FROM local_metadata WHERE id=1")?;
    if storage_id.len() != 32 || !storage_id.bytes().all(|byte| byte.is_ascii_hexdigit()) || created_at.is_empty() {
        return Err(StorageError::InvalidSchema);
    }
    Ok(StorageStatus { engine: "sqlite", schema_version: version, migration_count: version, storage_id, created_at })
}
