use super::{connect, sqlite::Transaction, StorageError};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskOwner { pub project_ref: String, pub user_id: String }

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TaskError { InvalidInput, NotFound, Conflict, Storage(StorageError) }
impl From<StorageError> for TaskError { fn from(value: StorageError) -> Self { Self::Storage(value) } }

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String, pub title: String, pub completed: bool, pub created_at: String, pub updated_at: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPage { pub items: Vec<Task>, pub has_more: bool }

impl TaskOwner {
    pub(super) fn validate(&self) -> Result<(), TaskError> {
        let project = self.project_ref.as_bytes();
        let user = self.user_id.as_bytes();
        if project.is_empty() || project.len() > 63 || !project[0].is_ascii_alphanumeric()
            || !project.iter().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
            || user.len() != 36 || !user.iter().enumerate().all(|(i, b)| {
                if [8, 13, 18, 23].contains(&i) { *b == b'-' } else { b.is_ascii_hexdigit() && !b.is_ascii_uppercase() }
            }) || self.user_id == "00000000-0000-0000-0000-000000000000" { return Err(TaskError::InvalidInput); }
        Ok(())
    }
}
fn valid_id(id: &str) -> bool { id.len() == 32 && id != "00000000000000000000000000000000" && id.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) }
fn valid_title(title: &str) -> bool { !title.is_empty() && title.chars().count() <= 200 && !title.chars().any(char::is_control) }
fn decode(row: Vec<String>) -> Result<Task, TaskError> {
    if row.len() != 5 || !valid_id(&row[0]) || !matches!(row[2].as_str(), "0" | "1") { return Err(StorageError::InvalidSchema.into()); }
    Ok(Task { id: row[0].clone(), title: row[1].clone(), completed: row[2] == "1", created_at: row[3].clone(), updated_at: row[4].clone() })
}
pub fn list(path: &Path, owner: &TaskOwner, offset: u32) -> Result<TaskPage, TaskError> {
    owner.validate()?;
    let (db, _) = connect(path)?;
    let rows = db.query("SELECT id,title,completed,created_at,updated_at FROM tasks WHERE project_ref=?1 AND user_id=?2 ORDER BY created_at DESC,id DESC LIMIT 101 OFFSET ?3",
        &[&owner.project_ref, &owner.user_id, &offset.to_string()])?;
    let has_more = rows.len() > 100;
    let items = rows.into_iter().take(100).map(decode).collect::<Result<_, _>>()?;
    Ok(TaskPage { items, has_more })
}
pub fn create(path: &Path, owner: &TaskOwner, id: &str, title: &str) -> Result<Task, TaskError> {
    owner.validate()?;
    let title = title.trim();
    if !valid_id(id) || !valid_title(title) { return Err(TaskError::InvalidInput); }
    let (db, _) = connect(path)?;
    let transaction = Transaction::begin(&db)?;
    // Stable client request ID makes an ambiguous create retry safe, without duplicate tasks.
    let existed = !db.query("SELECT id FROM tasks WHERE id=?1", &[id])?.is_empty();
    db.query("INSERT INTO tasks(id,project_ref,user_id,title) VALUES (?1,?2,?3,?4) ON CONFLICT(id) DO NOTHING",
        &[id, &owner.project_ref, &owner.user_id, title])?;
    let mut rows = db.query("SELECT id,title,completed,created_at,updated_at FROM tasks WHERE id=?1 AND project_ref=?2 AND user_id=?3",
        &[id, &owner.project_ref, &owner.user_id])?;
    let task = decode(rows.pop().ok_or(TaskError::Conflict)?)?;
    if task.title != title { return Err(TaskError::Conflict); }
    if !existed {
        // Create ID is also its stable operation ID. No backfill of pre-existing tasks.
        db.query("INSERT INTO task_outbox(project_ref,user_id,operation_id,task_id,kind,expected_revision,title) VALUES(?1,?2,?3,?3,'create',0,?4)",
            &[&owner.project_ref, &owner.user_id, id, title])?;
    }
    transaction.commit()?;
    Ok(task)
}
pub fn set_completed(path: &Path, owner: &TaskOwner, id: &str, completed: bool) -> Result<Task, TaskError> {
    owner.validate()?;
    if !valid_id(id) { return Err(TaskError::InvalidInput); }
    let (db, _) = connect(path)?;
    let transaction = Transaction::begin(&db)?;
    if !db.query("SELECT d.sequence FROM outbox_delivery d JOIN task_outbox o ON o.sequence=d.sequence WHERE o.project_ref=?1 AND o.user_id=?2 AND o.task_id=?3", &[&owner.project_ref,&owner.user_id,id])?.is_empty() { return Err(TaskError::Conflict); }
    db.query("UPDATE tasks SET completed=?4,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1 AND project_ref=?2 AND user_id=?3 AND completed<>?4",
        &[id, &owner.project_ref, &owner.user_id, if completed { "1" } else { "0" }])?;
    let mut rows = db.query("SELECT id,title,completed,created_at,updated_at FROM tasks WHERE id=?1 AND project_ref=?2 AND user_id=?3",
        &[id, &owner.project_ref, &owner.user_id])?;
    let task = decode(rows.pop().ok_or(TaskError::NotFound)?)?;
    transaction.commit()?;
    Ok(task)
}

pub fn rename(path: &Path, owner: &TaskOwner, id: &str, title: &str, expected_title: &str) -> Result<Task, TaskError> {
    owner.validate()?;
    let title = title.trim();
    if !valid_id(id) || !valid_title(title) || !valid_title(expected_title) { return Err(TaskError::InvalidInput); }
    let (db, _) = connect(path)?;
    let transaction = Transaction::begin(&db)?;
    let mut rows = db.query("SELECT id,title,completed,created_at,updated_at FROM tasks WHERE id=?1 AND project_ref=?2 AND user_id=?3",
        &[id, &owner.project_ref, &owner.user_id])?;
    let current = decode(rows.pop().ok_or(TaskError::NotFound)?)?;
    // A lost reply can be retried. A different intervening title must not be overwritten.
    if current.title == title { transaction.commit()?; return Ok(current); }
    if current.title != expected_title { return Err(TaskError::Conflict); }
    let rows = db.query("SELECT o.sequence,o.kind,o.state,COALESCE(CAST(d.revision AS TEXT),'') FROM task_outbox o LEFT JOIN outbox_delivery d ON d.sequence=o.sequence WHERE o.project_ref=?1 AND o.user_id=?2 AND o.task_id=?3 ORDER BY o.sequence DESC LIMIT 1", &[&owner.project_ref,&owner.user_id,id])?;
    if let Some(last) = rows.first() {
        match (last[1].as_str(),last[2].as_str()) {
            ("create","pending") if last[3].is_empty() && db.query("SELECT sequence FROM outbox_delivery WHERE sequence=?1", &[&last[0]])?.is_empty() => {
                // An untouched create snapshot can be replaced before any network attempt.
                db.query("DELETE FROM task_outbox WHERE sequence=?1", &[&last[0]])?;
                db.query("INSERT INTO task_outbox(project_ref,user_id,operation_id,task_id,kind,expected_revision,title) VALUES(?1,?2,lower(hex(randomblob(16))),?3,'create',0,?4)", &[&owner.project_ref,&owner.user_id,id,title])?;
            }
            (_,"acknowledged") => {
                let revision: i64 = last[3].parse().map_err(|_| StorageError::InvalidSchema)?;
                if revision < 1 { return Err(StorageError::InvalidSchema.into()); }
                db.query("INSERT INTO task_outbox(project_ref,user_id,operation_id,task_id,kind,expected_revision,title) VALUES(?1,?2,lower(hex(randomblob(16))),?3,'rename',?4,?5)", &[&owner.project_ref,&owner.user_id,id,&revision.to_string(),title])?;
            }
            _ => return Err(TaskError::Conflict),
        }
    }
    db.query("UPDATE tasks SET title=?4,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1 AND project_ref=?2 AND user_id=?3",
        &[id, &owner.project_ref, &owner.user_id, title])?;
    let mut rows = db.query("SELECT id,title,completed,created_at,updated_at FROM tasks WHERE id=?1 AND project_ref=?2 AND user_id=?3",
        &[id, &owner.project_ref, &owner.user_id])?;
    let task = decode(rows.pop().ok_or(TaskError::NotFound)?)?;
    transaction.commit()?;
    Ok(task)
}

pub fn delete(path: &Path, owner: &TaskOwner, id: &str, expected_title: &str) -> Result<(), TaskError> {
    owner.validate()?;
    if !valid_id(id) || !valid_title(expected_title) { return Err(TaskError::InvalidInput); }
    let (db, _) = connect(path)?;
    let transaction = Transaction::begin(&db)?;
    let rows = db.query("SELECT title FROM tasks WHERE id=?1 AND project_ref=?2 AND user_id=?3",
        &[id, &owner.project_ref, &owner.user_id])?;
    if let Some(row) = rows.first() {
        if row[0] != expected_title { return Err(TaskError::Conflict); }
        if !db.query("SELECT sequence FROM task_outbox WHERE project_ref=?1 AND user_id=?2 AND task_id=?3 AND state<>'pending'", &[&owner.project_ref,&owner.user_id,id])?.is_empty() { return Err(TaskError::Conflict); }
        db.query("DELETE FROM task_outbox WHERE project_ref=?1 AND user_id=?2 AND task_id=?3 AND state='pending'", &[&owner.project_ref,&owner.user_id,id])?;
        db.query("DELETE FROM tasks WHERE id=?1 AND project_ref=?2 AND user_id=?3", &[id, &owner.project_ref, &owner.user_id])?;
    }
    // Already absent in this owner partition: safe to retry without affecting any other owner.
    transaction.commit()?;
    Ok(())
}
