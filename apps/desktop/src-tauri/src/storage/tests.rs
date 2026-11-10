use super::*;
use std::{path::PathBuf, sync::atomic::{AtomicU64, Ordering}};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[test]
fn unsent_rename_replaces_operation_and_delete_cancels_it() {
    let temp = TestDirectory::new();
    let owner = task_owner("project-a", '1');
    let id = "a".repeat(32);
    tasks::create(&temp.db(), &owner, &id, "Before").unwrap();
    tasks::rename(&temp.db(), &owner, &id, "After", "Before").unwrap();
    let queue = outbox::pending(&temp.db(), &owner, 0).unwrap();
    assert_eq!(queue.len(), 1);
    assert_ne!(queue[0].operation_id, id);
    assert_eq!(queue[0].title, "After");
    tasks::rename(&temp.db(), &owner, &id, "After", "Before").unwrap();
    assert_eq!(outbox::pending(&temp.db(), &owner, 0).unwrap()[0].operation_id, queue[0].operation_id);
    assert_eq!(outbox::count(&temp.db(), &task_owner("other", '1')).unwrap(), 0);
    tasks::delete(&temp.db(), &owner, &id, "After").unwrap();
    assert_eq!(outbox::count(&temp.db(), &owner).unwrap(), 0);
}

#[test]
fn failed_queue_replacement_rolls_back_title_and_original_operation() {
    let temp = TestDirectory::new();
    let owner = task_owner("project-a", '1');
    let id = "a".repeat(32);
    tasks::create(&temp.db(), &owner, &id, "Before").unwrap();
    let (db, _) = connect(&temp.db()).unwrap();
    db.execute("CREATE TRIGGER fail_replace BEFORE INSERT ON task_outbox BEGIN SELECT RAISE(ABORT,'test'); END;").unwrap();
    assert!(tasks::rename(&temp.db(), &owner, &id, "After", "Before").is_err());
    assert_eq!(tasks::list(&temp.db(), &owner, 0).unwrap().items[0].title, "Before");
    assert_eq!(outbox::pending(&temp.db(), &owner, 0).unwrap()[0].operation_id, id);
}

#[test]
fn create_and_outbox_are_atomic_and_retries_keep_one_operation() {
    let temp = TestDirectory::new();
    let owner = task_owner("project-a", '1');
    let id = "a".repeat(32);
    tasks::create(&temp.db(), &owner, &id, "Original").unwrap();
    tasks::create(&temp.db(), &owner, &id, "Original").unwrap();
    let pending = outbox::pending(&temp.db(), &owner, 0).unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].operation_id, id);
    assert_eq!(pending[0].title, "Original");
    assert!(outbox::pending(&temp.db(), &task_owner("other", '1'), 0).unwrap().is_empty());
    assert!(outbox::pending(&temp.db(), &task_owner("project-a", '2'), 0).unwrap().is_empty());
    assert!(outbox::pending(&temp.db(), &owner, pending[0].sequence).unwrap().is_empty());
    let (db, _) = connect(&temp.db()).unwrap();
    db.execute("CREATE TRIGGER fail_enqueue BEFORE INSERT ON task_outbox BEGIN SELECT RAISE(ABORT,'injected failure'); END;").unwrap();
    assert!(tasks::create(&temp.db(), &owner, &"b".repeat(32), "Must roll back").is_err());
    assert_eq!(tasks::list(&temp.db(), &owner, 0).unwrap().items.len(), 1);
    assert_eq!(outbox::pending(&temp.db(), &owner, 0).unwrap().len(), 1);
}

#[test]
fn outbox_payload_persists_and_cannot_be_replaced_on_retry() {
    let temp = TestDirectory::new();
    let (db, _) = connect(&temp.db()).unwrap();
    let insert = "INSERT INTO task_outbox(project_ref,user_id,operation_id,task_id,kind,expected_revision,title) VALUES('project-a','11111111-1111-4111-8111-111111111111','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','create',0,'Test')";
    db.execute(insert).unwrap();
    assert!(db.execute(insert).is_err());
    assert!(db.execute("UPDATE task_outbox SET title='Changed'").is_err());
    assert!(db.execute("UPDATE task_outbox SET operation_id='cccccccccccccccccccccccccccccccc'").is_err());
    drop(db);
    let (db, _) = connect(&temp.db()).unwrap();
    assert_eq!(db.scalar("SELECT operation_id FROM task_outbox").unwrap(), "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    assert_eq!(db.scalar("SELECT count(*) FROM task_outbox WHERE project_ref='other-project'").unwrap(), "0");
    assert_eq!(db.scalar("SELECT title FROM task_outbox").unwrap(), "Test");
    {
        let _transaction = Transaction::begin(&db).unwrap();
        db.execute("UPDATE task_outbox SET state='acknowledged'").unwrap();
    }
    assert_eq!(db.scalar("SELECT state FROM task_outbox").unwrap(), "pending");
}

#[test]
fn outbox_upgrade_preserves_v2_tasks() {
    let temp = TestDirectory::new();
    let db = old_database(&temp.db());
    db.execute(TASK_MIGRATION).unwrap();
    let checksum = format!("{:x}", Sha256::digest(TASK_MIGRATION.replace("\r\n", "\n").as_bytes()));
    db.execute(&format!("INSERT INTO schema_migrations(version,name,checksum) VALUES(2,'local_tasks','{checksum}'); PRAGMA user_version=2;")).unwrap();
    db.execute("INSERT INTO tasks(id,project_ref,user_id,title) VALUES('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','project-a','11111111-1111-4111-8111-111111111111','Keep me')").unwrap();
    drop(db);
    let (db, status) = connect(&temp.db()).unwrap();
    assert_eq!(status.schema_version, 3);
    assert_eq!(db.scalar("SELECT title FROM tasks").unwrap(), "Keep me");
    assert_eq!(db.scalar("SELECT count(*) FROM task_outbox").unwrap(), "0");
}

fn old_database(path: &Path) -> Connection {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let db = Connection::open(path).unwrap();
    db.execute(MIGRATION).unwrap();
    let checksum = format!("{:x}", Sha256::digest(MIGRATION.replace("\r\n", "\n").as_bytes()));
    db.execute(&format!("INSERT INTO schema_migrations(version,name,checksum) VALUES(1,'local_foundation','{checksum}'); PRAGMA user_version=1; PRAGMA application_id={APPLICATION_ID};")).unwrap();
    db
}

#[test]
fn upgrades_v1_without_changing_identity_and_failed_v2_rolls_back() {
    let temp = TestDirectory::new();
    let db = old_database(&temp.db());
    let id = db.scalar("SELECT storage_id FROM local_metadata").unwrap();
    let failing = format!("{TASK_MIGRATION}\nINSERT INTO missing VALUES(1);");
    assert_eq!(migrate_with_tasks(&db, MIGRATION, &failing), Err(StorageError::MigrationFailed));
    assert_eq!(db.scalar("PRAGMA user_version").unwrap(), "1");
    assert_eq!(db.scalar("SELECT count(*) FROM schema_migrations").unwrap(), "1");
    assert_eq!(db.scalar("SELECT count(*) FROM sqlite_master WHERE name='tasks'").unwrap(), "0");
    drop(db);
    let status = open_storage(&temp.db()).unwrap();
    assert_eq!(status.storage_id, id);
    assert_eq!(status.schema_version, 3);
}

fn task_owner(project: &str, user: char) -> tasks::TaskOwner {
    tasks::TaskOwner { project_ref: project.into(), user_id: format!("{user}1111111-1111-4111-8111-111111111111") }
}

#[test]
fn tasks_persist_unicode_and_sql_text_without_executing_it() {
    let temp = TestDirectory::new();
    let owner = task_owner("project-a", '1');
    let title = "  Çalışma '); DROP TABLE tasks; -- 🗓️  ";
    let task = tasks::create(&temp.db(), &owner, &"a".repeat(32), title).unwrap();
    assert_eq!(task.title, title.trim());
    assert_eq!(tasks::list(&temp.db(), &owner, 0).unwrap().items, vec![task]);
    let done = tasks::set_completed(&temp.db(), &owner, &"a".repeat(32), true).unwrap();
    assert!(done.completed);
    assert_eq!(tasks::set_completed(&temp.db(), &owner, &done.id, true).unwrap(), done);
    assert!(!tasks::set_completed(&temp.db(), &owner, &done.id, false).unwrap().completed);
}

#[test]
fn task_owner_scope_and_idempotent_create_prevent_cross_account_mutation() {
    let temp = TestDirectory::new();
    let owner = task_owner("project-a", '1');
    let id = "a".repeat(32);
    let first = tasks::create(&temp.db(), &owner, &id, "Plan yap").unwrap();
    assert_eq!(tasks::create(&temp.db(), &owner, &id, "Plan yap").unwrap(), first);
    assert_eq!(tasks::create(&temp.db(), &owner, &id, "Farklı"), Err(tasks::TaskError::Conflict));
    for other in [task_owner("project-b", '1'), task_owner("project-a", '2')] {
        assert!(tasks::list(&temp.db(), &other, 0).unwrap().items.is_empty());
        assert_eq!(tasks::set_completed(&temp.db(), &other, &id, true), Err(tasks::TaskError::NotFound));
        assert_eq!(tasks::create(&temp.db(), &other, &id, "Plan yap"), Err(tasks::TaskError::Conflict));
    }
    assert_eq!(tasks::list(&temp.db(), &owner, 0).unwrap().items, vec![first]);
}

#[test]
fn invalid_task_input_is_rejected_before_creating_a_database() {
    let temp = TestDirectory::new();
    let owner = task_owner("project-a", '1');
    for title in [" ".into(), "a".repeat(201), "bad\0title".into(), "two\nlines".into()] {
        assert_eq!(tasks::create(&temp.db(), &owner, &"a".repeat(32), &title), Err(tasks::TaskError::InvalidInput));
    }
    assert_eq!(tasks::create(&temp.db(), &owner, "invalid", "Title"), Err(tasks::TaskError::InvalidInput));
    assert!(tasks::list(&temp.db(), &task_owner("../project", '1'), 0).is_err());
    assert!(!temp.db().exists());
}

#[test]
fn task_pages_have_stable_order_and_no_duplicates() {
    let temp = TestDirectory::new();
    let owner = task_owner("project-a", '1');
    for i in 1..104 { tasks::create(&temp.db(), &owner, &format!("{i:032x}"), "Test task").unwrap(); }
    let queued = outbox::pending(&temp.db(), &owner, 0).unwrap();
    assert_eq!(queued.len(), 100);
    let remainder = outbox::pending(&temp.db(), &owner, queued.last().unwrap().sequence).unwrap();
    assert_eq!(remainder.len(), 3);
    assert!(remainder[0].sequence > queued.last().unwrap().sequence);
    let first = tasks::list(&temp.db(), &owner, 0).unwrap();
    let second = tasks::list(&temp.db(), &owner, 100).unwrap();
    assert_eq!(first.items.len(), 100); assert!(first.has_more);
    assert_eq!(second.items.len(), 3); assert!(!second.has_more);
    assert!(second.items.iter().all(|task| !first.items.iter().any(|other| other.id == task.id)));
}

#[test]
fn rename_preserves_completion_identity_and_is_safe_to_retry() {
    let temp = TestDirectory::new(); let owner = task_owner("project-a", '1'); let id = "b".repeat(32);
    let original = tasks::create(&temp.db(), &owner, &id, "Eski başlık").unwrap();
    tasks::set_completed(&temp.db(), &owner, &id, true).unwrap();
    let renamed = tasks::rename(&temp.db(), &owner, &id, "  Yeni 'başlık' 📝  ", &original.title).unwrap();
    assert_eq!(renamed.title, "Yeni 'başlık' 📝"); assert!(renamed.completed);
    assert_eq!(renamed.id, original.id); assert_eq!(renamed.created_at, original.created_at);
    assert_eq!(tasks::rename(&temp.db(), &owner, &id, &renamed.title, &original.title).unwrap(), renamed);
    assert_eq!(tasks::list(&temp.db(), &owner, 0).unwrap().items, vec![renamed]);
}

#[test]
fn stale_titles_block_rename_and_delete_without_changing_the_record() {
    let temp = TestDirectory::new(); let owner = task_owner("project-a", '1'); let id = "b".repeat(32);
    tasks::create(&temp.db(), &owner, &id, "İlk").unwrap();
    let current = tasks::rename(&temp.db(), &owner, &id, "Başka pencereden", "İlk").unwrap();
    assert_eq!(tasks::rename(&temp.db(), &owner, &id, "Eski taslak", "İlk"), Err(tasks::TaskError::Conflict));
    assert_eq!(tasks::delete(&temp.db(), &owner, &id, "İlk"), Err(tasks::TaskError::Conflict));
    assert_eq!(tasks::list(&temp.db(), &owner, 0).unwrap().items, vec![current]);
}

#[test]
fn deleting_is_persistent_idempotent_and_owner_scoped() {
    let temp = TestDirectory::new(); let owner = task_owner("project-a", '1'); let id = "c".repeat(32);
    let task = tasks::create(&temp.db(), &owner, &id, "Silinecek görev").unwrap();
    for other in [task_owner("project-b", '1'), task_owner("project-a", '2')] {
        assert_eq!(tasks::rename(&temp.db(), &other, &id, "Yeni", &task.title), Err(tasks::TaskError::NotFound));
        tasks::delete(&temp.db(), &other, &id, &task.title).unwrap();
        assert_eq!(tasks::list(&temp.db(), &owner, 0).unwrap().items.as_slice(), std::slice::from_ref(&task));
    }
    tasks::delete(&temp.db(), &owner, &id, &task.title).unwrap();
    tasks::delete(&temp.db(), &owner, &id, &task.title).unwrap();
    assert!(tasks::list(&temp.db(), &owner, 0).unwrap().items.is_empty());
    assert_eq!(tasks::rename(&temp.db(), &owner, &id, "Yeni", &task.title), Err(tasks::TaskError::NotFound));
}

#[test]
fn invalid_edit_and_delete_do_not_touch_existing_tasks() {
    let temp = TestDirectory::new(); let owner = task_owner("project-a", '1'); let id = "d".repeat(32);
    let task = tasks::create(&temp.db(), &owner, &id, "Koru").unwrap();
    for title in [" ".into(), "x".repeat(201), "bad\0value".into()] {
        assert_eq!(tasks::rename(&temp.db(), &owner, &id, &title, &task.title), Err(tasks::TaskError::InvalidInput));
    }
    assert_eq!(tasks::delete(&temp.db(), &owner, "invalid-id", &task.title), Err(tasks::TaskError::InvalidInput));
    assert_eq!(tasks::list(&temp.db(), &owner, 0).unwrap().items, vec![task]);
}
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
fn first_open_creates_real_sqlite_and_foundation_and_tasks_tables() {
    let temp = TestDirectory::new();
    let status = open_storage(&temp.db()).unwrap();
    assert_eq!(status.schema_version, 3);
    assert_eq!(&fs::read(temp.db()).unwrap()[..16], b"SQLite format 3\0");
    let db = Connection::open(&temp.db()).unwrap();
    assert_eq!(db.scalar("SELECT group_concat(name, ',') FROM (SELECT name FROM sqlite_master WHERE type='table' ORDER BY name)").unwrap(), "local_metadata,schema_migrations,sqlite_sequence,task_outbox,tasks");
    assert_eq!(db.scalar("PRAGMA journal_mode").unwrap(), "wal");
}

#[test]
fn closing_and_reopening_preserves_identity_and_applies_migration_once() {
    let temp = TestDirectory::new();
    let first = open_storage(&temp.db()).unwrap();
    let second = open_storage(&temp.db()).unwrap();
    assert_eq!(first, second);
    let db = Connection::open(&temp.db()).unwrap();
    assert_eq!(db.scalar("SELECT count(*) FROM schema_migrations").unwrap(), "3");
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
    db.execute("PRAGMA user_version=4").unwrap();
    assert_eq!(open_storage(&temp.db()), Err(StorageError::NewerSchema));
    assert_eq!(db.scalar("PRAGMA user_version").unwrap(), "4");
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
