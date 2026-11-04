use super::*;
use std::{path::PathBuf, sync::atomic::{AtomicU64, Ordering}};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);
struct TestDirectory(PathBuf);
impl TestDirectory {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("personal-os-sqlite-{}-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&root).unwrap(); // Never adopt an existing directory.
        Self(root)
    }
    fn db(&self) -> PathBuf { self.0.join("Türkçe alan").join("personal-os.sqlite3") }
}
impl Drop for TestDirectory {
    fn drop(&mut self) { fs::remove_dir_all(&self.0).unwrap(); }
}

#[test]
fn first_open_creates_real_sqlite_and_only_foundation_tables() {
    let temp = TestDirectory::new();
    let status = open_storage(&temp.db()).unwrap();
    assert_eq!(status.schema_version, 1);
    assert_eq!(&fs::read(temp.db()).unwrap()[..16], b"SQLite format 3\0");
    let db = Connection::open(&temp.db()).unwrap();
    assert_eq!(db.scalar("SELECT group_concat(name, ',') FROM (SELECT name FROM sqlite_master WHERE type='table' ORDER BY name)").unwrap(), "local_metadata,schema_migrations");
    assert_eq!(db.scalar("PRAGMA journal_mode").unwrap(), "wal");
}

#[test]
fn closing_and_reopening_preserves_identity_and_applies_migration_once() {
    let temp = TestDirectory::new();
    let first = open_storage(&temp.db()).unwrap();
    let second = open_storage(&temp.db()).unwrap();
    assert_eq!(first, second);
    let db = Connection::open(&temp.db()).unwrap();
    assert_eq!(db.scalar("SELECT count(*) FROM schema_migrations").unwrap(), "1");
}

#[test]
fn failed_migration_rolls_back_ddl_data_journal_and_version() {
    let temp = TestDirectory::new();
    fs::create_dir_all(temp.db().parent().unwrap()).unwrap();
    let db = Connection::open(&temp.db()).unwrap();
    let failing = format!("{MIGRATION}\nINSERT INTO missing_table VALUES (1);");
    assert_eq!(migrate(&db, &failing), Err(StorageError::MigrationFailed));
    assert_eq!(db.scalar("SELECT count(*) FROM sqlite_master WHERE type='table'").unwrap(), "0");
    assert_eq!(db.scalar("PRAGMA user_version").unwrap(), "0");
    assert_eq!(db.scalar("PRAGMA application_id").unwrap(), "0");
    drop(db);
    assert!(open_storage(&temp.db()).is_ok());
}

#[test]
fn newer_schema_is_rejected_without_resetting_existing_data() {
    let temp = TestDirectory::new();
    let original = open_storage(&temp.db()).unwrap();
    let db = Connection::open(&temp.db()).unwrap();
    db.execute("PRAGMA user_version=2").unwrap();
    assert_eq!(open_storage(&temp.db()), Err(StorageError::NewerSchema));
    assert_eq!(db.scalar("PRAGMA user_version").unwrap(), "2");
    assert_eq!(db.scalar("SELECT storage_id FROM local_metadata").unwrap(), original.storage_id);
}

#[test]
fn foreign_database_is_not_adopted_or_overwritten() {
    let temp = TestDirectory::new();
    fs::create_dir_all(temp.db().parent().unwrap()).unwrap();
    let db = Connection::open(&temp.db()).unwrap();
    db.execute("CREATE TABLE unrelated (value TEXT); INSERT INTO unrelated VALUES ('keep');").unwrap();
    assert_eq!(open_storage(&temp.db()), Err(StorageError::InvalidSchema));
    assert_eq!(db.scalar("SELECT value FROM unrelated").unwrap(), "keep");
    assert_eq!(db.scalar("PRAGMA user_version").unwrap(), "0");
}

#[test]
fn corrupt_database_is_reported_and_original_bytes_are_preserved() {
    let temp = TestDirectory::new();
    fs::create_dir_all(temp.db().parent().unwrap()).unwrap();
    let bytes = b"This is not SQLite; do not replace this file.";
    fs::write(temp.db(), bytes).unwrap();
    assert_eq!(open_storage(&temp.db()), Err(StorageError::Corrupt));
    assert_eq!(fs::read(temp.db()).unwrap(), bytes);
}

#[test]
fn edited_migration_journal_is_rejected() {
    let temp = TestDirectory::new();
    open_storage(&temp.db()).unwrap();
    let db = Connection::open(&temp.db()).unwrap();
    db.execute("UPDATE schema_migrations SET checksum='changed'").unwrap();
    assert_eq!(open_storage(&temp.db()), Err(StorageError::InvalidSchema));
    assert_eq!(db.scalar("SELECT checksum FROM schema_migrations").unwrap(), "changed");
}

#[test]
fn sql_line_endings_do_not_change_the_migration_identity() {
    let temp = TestDirectory::new();
    let original = open_storage(&temp.db()).unwrap();
    let db = Connection::open(&temp.db()).unwrap();
    assert_eq!(migrate(&db, &MIGRATION.replace('\n', "\r\n")).unwrap(), original);
}

#[test]
fn busy_database_returns_a_bounded_error_then_recovers() {
    let temp = TestDirectory::new();
    let original = open_storage(&temp.db()).unwrap();
    let db = Connection::open(&temp.db()).unwrap();
    let lock = Transaction::begin(&db).unwrap();
    assert_eq!(open_storage(&temp.db()), Err(StorageError::Busy));
    drop(lock);
    assert_eq!(open_storage(&temp.db()).unwrap(), original);
}

#[test]
fn invalid_parent_path_is_reported_without_overwriting_it() {
    let temp = TestDirectory::new();
    let file = temp.0.join("occupied");
    fs::write(&file, b"keep").unwrap();
    assert_eq!(open_storage(&file.join("personal-os.sqlite3")), Err(StorageError::Unavailable));
    assert_eq!(fs::read(file).unwrap(), b"keep");
}

#[test]
fn simultaneous_first_opens_share_one_migration_and_identity() {
    let temp = TestDirectory::new();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let handles: Vec<_> = (0..2).map(|_| {
        let path = temp.db();
        let barrier = barrier.clone();
        std::thread::spawn(move || { barrier.wait(); open_storage(&path).unwrap() })
    }).collect();
    let statuses: Vec<_> = handles.into_iter().map(|handle| handle.join().unwrap()).collect();
    assert_eq!(statuses[0], statuses[1]);
}

#[test]
fn persists_across_separate_process_restarts() {
    const CHILD_PATH: &str = "PERSONAL_OS_STORAGE_PROCESS_TEST";
    if let Some(path) = std::env::var_os(CHILD_PATH) {
        let status = open_storage(&PathBuf::from(path)).unwrap();
        println!("PERSISTED_STORAGE_ID={}", status.storage_id);
        return;
    }
    let temp = TestDirectory::new();
    let run = || {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "storage::tests::persists_across_separate_process_restarts", "--nocapture"])
            .env(CHILD_PATH, temp.db()).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        String::from_utf8(output.stdout).unwrap().lines()
            .find_map(|line| line.strip_prefix("PERSISTED_STORAGE_ID=")).unwrap().to_owned()
    };
    let first = run();
    assert_eq!(first.len(), 32);
    assert_eq!(first, run());
}
