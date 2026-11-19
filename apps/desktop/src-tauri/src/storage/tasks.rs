use super::{connect, sqlite::Transaction, StorageError};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskOwner { pub project_ref: String, pub user_id: String }

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TaskError { InvalidInput, NotFound, Conflict, RecoveryRequired, Storage(StorageError) }
impl From<StorageError> for TaskError { fn from(value: StorageError) -> Self { Self::Storage(value) } }

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String, pub title: String, pub completed: bool, pub created_at: String, pub updated_at: String,
    pub project_id: Option<String>, pub due_date: Option<String>, pub priority: u8,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPage { pub items: Vec<Task>, pub has_more: bool }
#[derive(Debug,Serialize,PartialEq)]
#[serde(rename_all="camelCase")]
pub struct ProjectProgress { pub project_id:String,pub total:u32,pub completed:u32,pub overdue:u32 }

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
fn valid_date(value: &str) -> bool {
    let parts: Vec<_> = value.split('-').collect();
    if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 { return false; }
    let Ok(year) = parts[0].parse::<u32>() else { return false; };
    let Ok(month) = parts[1].parse::<u32>() else { return false; };
    let Ok(day) = parts[2].parse::<u32>() else { return false; };
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max = match month { 1|3|5|7|8|10|12 => 31, 4|6|9|11 => 30, 2 if leap => 29, 2 => 28, _ => return false };
    day >= 1 && day <= max
}
const TASK_SELECT: &str = "SELECT t.id,t.title,t.completed,t.created_at,t.updated_at,COALESCE(a.project_id,''),COALESCE(a.due_date,''),COALESCE(CAST(a.priority AS TEXT),'0') FROM tasks t LEFT JOIN task_attributes a ON a.task_id=t.id";
fn decode(row: Vec<String>) -> Result<Task, TaskError> {
    if row.len() != 8 || !valid_id(&row[0]) || !matches!(row[2].as_str(), "0" | "1") || !matches!(row[7].as_str(), "0"|"1"|"2"|"3") { return Err(StorageError::InvalidSchema.into()); }
    Ok(Task { id: row[0].clone(), title: row[1].clone(), completed: row[2] == "1", created_at: row[3].clone(), updated_at: row[4].clone(),
        project_id: (!row[5].is_empty()).then(|| row[5].clone()), due_date: (!row[6].is_empty()).then(|| row[6].clone()), priority: row[7].parse().map_err(|_| StorageError::InvalidSchema)? })
}
fn find(db: &super::sqlite::Connection, owner: &TaskOwner, id: &str) -> Result<Task, TaskError> {
    let mut rows = db.query(&format!("{TASK_SELECT} WHERE t.id=?1 AND t.project_ref=?2 AND t.user_id=?3"), &[id,&owner.project_ref,&owner.user_id])?;
    decode(rows.pop().ok_or(TaskError::NotFound)?)
}
pub fn list(path: &Path, owner: &TaskOwner, offset: u32) -> Result<TaskPage, TaskError> {
    list_for_project(path, owner, offset, None)
}
#[derive(Clone, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct TaskFilters { pub query:String,pub status:String,pub date:String,pub priority:String,pub sort:String,pub today:String,pub week:String }
pub fn list_for_project(path:&Path,owner:&TaskOwner,offset:u32,project:Option<&str>)->Result<TaskPage,TaskError>{list_filtered(path,owner,offset,project,None)}
pub fn list_filtered(path:&Path,owner:&TaskOwner,offset:u32,project:Option<&str>,filters:Option<&TaskFilters>)->Result<TaskPage,TaskError>{
 owner.validate()?;
 if project.is_some_and(|value|value!="none"&&!valid_id(value)){return Err(TaskError::InvalidInput)}
 let default=TaskFilters{query:String::new(),status:"all".into(),date:"all".into(),priority:"all".into(),sort:"newest".into(),today:"2000-01-01".into(),week:"2000-01-08".into()};let f=filters.unwrap_or(&default);
 if f.query.chars().count()>200||!matches!(f.status.as_str(),"all"|"open"|"done")||!matches!(f.date.as_str(),"all"|"none"|"today"|"week"|"overdue")||!matches!(f.priority.as_str(),"all"|"high"|"critical")||!matches!(f.sort.as_str(),"due"|"priority"|"newest")||f.today.len()!=10||f.week.len()!=10{return Err(TaskError::InvalidInput)}
 let order=match f.sort.as_str(){"due"=>"a.due_date IS NULL,a.due_date,COALESCE(a.priority,0) DESC,t.id", "priority"=>"COALESCE(a.priority,0) DESC,a.due_date IS NULL,a.due_date,t.id",_=>"t.created_at DESC,t.id DESC"};
 let(db,_)=connect(path)?;
 let sql=format!("{TASK_SELECT} WHERE t.project_ref=?1 AND t.user_id=?2 AND (?3='' OR (?3='none' AND a.project_id IS NULL) OR a.project_id=?3) AND (?4='all' OR (?4='open' AND t.completed=0) OR (?4='done' AND t.completed=1)) AND (?5='all' OR (?5='high' AND a.priority>=2) OR (?5='critical' AND a.priority=3)) AND (?6='all' OR (?6='none' AND a.due_date IS NULL) OR (?6='today' AND a.due_date=?7) OR (?6='week' AND a.due_date>=?7 AND a.due_date<=?8) OR (?6='overdue' AND t.completed=0 AND a.due_date<?7)) ORDER BY {order}");
 let fold=|text:&str|text.replace('I',"ı").replace('İ',"i").to_lowercase();let query=fold(f.query.trim());
 let mut found=Vec::new();let mut skipped=0;
 let sql=if query.is_empty(){format!("{sql} LIMIT 101 OFFSET {offset}")}else{sql};
 for row in db.query(&sql,&[&owner.project_ref,&owner.user_id,project.unwrap_or(""),&f.status,&f.priority,&f.date,&f.today,&f.week])? {
 let task=decode(row)?;if !fold(&task.title).contains(&query){continue}if !query.is_empty()&&skipped<offset{skipped+=1;continue}found.push(task);if found.len()==101{break}
 }
 let has_more=found.len()>100;found.truncate(100);Ok(TaskPage{items:found,has_more})
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
    let task = find(&db, owner, id).map_err(|error| if error == TaskError::NotFound { TaskError::Conflict } else { error })?;
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
    if !db.query("SELECT sequence FROM task_action_outbox WHERE project_ref=?1 AND user_id=?2 AND task_id=?3 AND state='pending'", &[&owner.project_ref,&owner.user_id,id])?.is_empty() { return Err(TaskError::Conflict); }
    if !db.query("SELECT d.sequence FROM outbox_delivery d JOIN task_outbox o ON o.sequence=d.sequence WHERE o.project_ref=?1 AND o.user_id=?2 AND o.task_id=?3", &[&owner.project_ref,&owner.user_id,id])?.is_empty() { return Err(TaskError::Conflict); }
    db.query("UPDATE tasks SET completed=?4,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1 AND project_ref=?2 AND user_id=?3 AND completed<>?4",
        &[id, &owner.project_ref, &owner.user_id, if completed { "1" } else { "0" }])?;
    let task = find(&db, owner, id)?;
    transaction.commit()?;
    Ok(task)
}

pub fn rename(path: &Path, owner: &TaskOwner, id: &str, title: &str, expected_title: &str) -> Result<Task, TaskError> {
    owner.validate()?;
    let title = title.trim();
    if !valid_id(id) || !valid_title(title) || !valid_title(expected_title) { return Err(TaskError::InvalidInput); }
    let (db, _) = connect(path)?;
    let transaction = Transaction::begin(&db)?;
    if !db.query("SELECT sequence FROM task_action_outbox WHERE project_ref=?1 AND user_id=?2 AND task_id=?3 AND state='pending'", &[&owner.project_ref,&owner.user_id,id])?.is_empty() { return Err(TaskError::Conflict); }
    let current = find(&db, owner, id)?;
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
                let revision = super::outbox::latest_revision(&db,owner,id)?.ok_or(StorageError::InvalidSchema)?;
                if revision < 1 { return Err(StorageError::InvalidSchema.into()); }
                db.query("INSERT INTO task_outbox(project_ref,user_id,operation_id,task_id,kind,expected_revision,title) VALUES(?1,?2,lower(hex(randomblob(16))),?3,'rename',?4,?5)", &[&owner.project_ref,&owner.user_id,id,&revision.to_string(),title])?;
            }
            _ => return Err(TaskError::Conflict),
        }
    }
    db.query("UPDATE tasks SET title=?4,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1 AND project_ref=?2 AND user_id=?3",
        &[id, &owner.project_ref, &owner.user_id, title])?;
    let task = find(&db, owner, id)?;
    transaction.commit()?;
    Ok(task)
}

pub fn set_planning(path: &Path, owner: &TaskOwner, id: &str, project_id: Option<&str>, due_date: Option<&str>, priority: u8) -> Result<Task, TaskError> {
    owner.validate()?;
    if !valid_id(id) || priority > 3 || due_date.is_some_and(|date| !valid_date(date)) || project_id.is_some_and(|value| !valid_id(value)) { return Err(TaskError::InvalidInput); }
    let (db, _) = connect(path)?;
    let transaction = Transaction::begin(&db)?;
    find(&db, owner, id)?;
    if let Some(project) = project_id {
        if db.query("SELECT id FROM workspace_entries WHERE id=?1 AND project_ref=?2 AND user_id=?3 AND kind='project'", &[project,&owner.project_ref,&owner.user_id])?.is_empty() { return Err(TaskError::InvalidInput); }
    }
    db.query("INSERT INTO task_attributes(task_id,project_ref,user_id,project_id,due_date,priority) VALUES(?1,?2,?3,NULLIF(?4,''),NULLIF(?5,''),?6) ON CONFLICT(task_id) DO UPDATE SET project_id=excluded.project_id,due_date=excluded.due_date,priority=excluded.priority",
        &[id,&owner.project_ref,&owner.user_id,project_id.unwrap_or(""),due_date.unwrap_or(""),&priority.to_string()])?;
    let task = find(&db, owner, id)?;
    transaction.commit()?;
    Ok(task)
}

pub fn scheduled(path: &Path, owner: &TaskOwner, from: &str, to: &str) -> Result<Vec<Task>, TaskError> {
    owner.validate()?;
    if !valid_date(from) || !valid_date(to) || from > to { return Err(TaskError::InvalidInput); }
    let (db, _) = connect(path)?;
    db.query(&format!("{TASK_SELECT} WHERE t.project_ref=?1 AND t.user_id=?2 AND a.due_date>=?3 AND a.due_date<=?4 ORDER BY a.due_date ASC,a.priority DESC,t.created_at ASC LIMIT 500"),
        &[&owner.project_ref,&owner.user_id,from,to])?.into_iter().map(decode).collect()
}

pub fn project_progress(path:&Path,owner:&TaskOwner,today:&str)->Result<Vec<ProjectProgress>,TaskError>{
    owner.validate()?; if !valid_date(today){return Err(TaskError::InvalidInput)} let(db,_)=connect(path)?;
    db.query("SELECT a.project_id,CAST(count(*) AS TEXT),CAST(sum(t.completed) AS TEXT),CAST(sum(CASE WHEN t.completed=0 AND a.due_date IS NOT NULL AND a.due_date<?3 THEN 1 ELSE 0 END) AS TEXT) FROM task_attributes a JOIN tasks t ON t.id=a.task_id WHERE a.project_ref=?1 AND a.user_id=?2 AND a.project_id IS NOT NULL GROUP BY a.project_id ORDER BY a.project_id",&[&owner.project_ref,&owner.user_id,today])?.into_iter().map(|row|{
        if row.len()!=4||!valid_id(&row[0]){return Err(StorageError::InvalidSchema.into())}
        let total=row[1].parse().map_err(|_|StorageError::InvalidSchema)?;let completed=row[2].parse().map_err(|_|StorageError::InvalidSchema)?;let overdue=row[3].parse().map_err(|_|StorageError::InvalidSchema)?;
        Ok(ProjectProgress{project_id:row[0].clone(),total,completed,overdue})
    }).collect()
}

pub fn delete(path: &Path, owner: &TaskOwner, id: &str, expected_title: &str) -> Result<(), TaskError> {
    owner.validate()?;
    if !valid_id(id) || !valid_title(expected_title) { return Err(TaskError::InvalidInput); }
    let (db, _) = connect(path)?;
    let transaction = Transaction::begin(&db)?;
    if !db.query("SELECT sequence FROM task_action_outbox WHERE project_ref=?1 AND user_id=?2 AND task_id=?3 AND state='pending'", &[&owner.project_ref,&owner.user_id,id])?.is_empty() { return Err(TaskError::Conflict); }
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

#[derive(Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct WorkspaceSummary {
 pub total:u64,pub completed:u64,pub overdue:u64,pub today:u64,pub upcoming:u64,pub unscheduled:u64,
 pub active_projects:u64,pub paused_projects:u64,pub done_projects:u64,pub today_events:u64,
}
pub fn summary(path:&Path,owner:&TaskOwner,today:&str,week:&str)->Result<WorkspaceSummary,TaskError>{
 owner.validate()?;if !valid_date(today)||!valid_date(week)||week<today{return Err(TaskError::InvalidInput)}
 let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;
 let rows=db.query("SELECT COUNT(*),COALESCE(SUM(t.completed),0),COALESCE(SUM(t.completed=0 AND a.due_date<?3),0),COALESCE(SUM(t.completed=0 AND a.due_date=?3),0),COALESCE(SUM(t.completed=0 AND a.due_date>=?3 AND a.due_date<=?4),0),COALESCE(SUM(t.completed=0 AND a.due_date IS NULL),0) FROM tasks t LEFT JOIN task_attributes a ON a.task_id=t.id WHERE t.project_ref=?1 AND t.user_id=?2",&[&owner.project_ref,&owner.user_id,today,week])?;
 let projects=db.query("SELECT COALESCE(SUM(state='active'),0),COALESCE(SUM(state='paused'),0),COALESCE(SUM(state='done'),0) FROM workspace_entries WHERE project_ref=?1 AND user_id=?2 AND kind='project'",&[&owner.project_ref,&owner.user_id])?;
 let events=db.query("SELECT COUNT(*) FROM calendar_events WHERE project_ref=?1 AND user_id=?2 AND event_date=?3",&[&owner.project_ref,&owner.user_id,today])?;
 let n=|rows:&Vec<Vec<String>>,i:usize|->Result<u64,TaskError>{rows.first().and_then(|r|r.get(i)).ok_or(StorageError::InvalidSchema)?.parse().map_err(|_|StorageError::InvalidSchema.into())};
 let result=WorkspaceSummary{total:n(&rows,0)?,completed:n(&rows,1)?,overdue:n(&rows,2)?,today:n(&rows,3)?,upcoming:n(&rows,4)?,unscheduled:n(&rows,5)?,active_projects:n(&projects,0)?,paused_projects:n(&projects,1)?,done_projects:n(&projects,2)?,today_events:n(&events,0)?};
 tx.commit()?;Ok(result)
}

pub fn get_record(path:&Path,owner:&TaskOwner,id:&str)->Result<Task,TaskError>{owner.validate()?;if !valid_id(id){return Err(TaskError::InvalidInput)}let(db,_)=connect(path)?;find(&db,owner,id)}
