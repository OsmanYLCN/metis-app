use super::{connect, sqlite::Transaction, tasks::{TaskError, TaskOwner}, StorageError};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub state: String,
    pub pinned: bool,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryPage { pub items: Vec<Entry>, pub has_more: bool }

fn valid_id(id: &str) -> bool {
    id.len()==32 && id!="00000000000000000000000000000000"
        && id.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
fn valid_payload(kind: &str, title: &str, body: &str, state: &str, pinned: bool) -> bool {
    matches!(kind,"note"|"project") && !title.is_empty() && title.chars().count()<=200
        && !title.chars().any(char::is_control) && body.chars().count()<=20000
        && !body.chars().any(|c| c.is_control() && !matches!(c,'\n'|'\r'|'\t'))
        && ((kind=="note" && state=="active") || (kind=="project" && !pinned && matches!(state,"active"|"paused"|"done")))
}
fn decode(row: &[String]) -> Result<Entry,TaskError> {
    if row.len()!=9 || !valid_id(&row[0]) || !matches!(row[4].as_str(),"0"|"1") { return Err(StorageError::InvalidSchema.into()); }
    let revision=row[5].parse().map_err(|_|StorageError::InvalidSchema)?;
    if revision<1 || !valid_payload(&row[1],&row[2],&row[3],&row[6],row[4]=="1") { return Err(StorageError::InvalidSchema.into()); }
    Ok(Entry { id:row[0].clone(),kind:row[1].clone(),title:row[2].clone(),body:row[3].clone(),
        state:row[6].clone(),pinned:row[4]=="1",revision,created_at:row[7].clone(),updated_at:row[8].clone() })
}
const FIELDS: &str = "id,kind,title,body,pinned,revision,state,created_at,updated_at";

pub fn list(path: &Path, owner: &TaskOwner, kind: &str, query: &str, offset: u32) -> Result<EntryPage,TaskError> {
    list_filtered(path,owner,kind,query,offset,"all","updated")
}
pub fn list_filtered(path:&Path,owner:&TaskOwner,kind:&str,query:&str,offset:u32,filter:&str,sort:&str)->Result<EntryPage,TaskError>{
    owner.validate()?;
    if !matches!(sort,"updated"|"created"|"title") || !(filter=="all" || (kind=="note"&&filter=="pinned") || (kind=="project"&&matches!(filter,"active"|"paused"|"done"))){return Err(TaskError::InvalidInput)}
    if !matches!(kind,"note"|"project") || query.chars().count()>100 || query.chars().any(char::is_control)
        || offset>10000 { return Err(TaskError::InvalidInput); }
    let (db,_) = connect(path)?;
    let order=match sort{"title"=>"title COLLATE NOCASE,id","created"=>"created_at DESC,id DESC",_=>"pinned DESC,updated_at DESC,id DESC"};
    let sql=format!("SELECT {FIELDS} FROM workspace_entries WHERE project_ref=?1 AND user_id=?2 AND kind=?3 AND (?4='' OR title LIKE '%'||?4||'%' OR body LIKE '%'||?4||'%') AND (?6='all' OR (?6='pinned' AND pinned=1) OR state=?6) ORDER BY {order} LIMIT 101 OFFSET ?5");
    let rows=db.query(&sql,&[&owner.project_ref,&owner.user_id,kind,query,&offset.to_string(),filter])?;
    let has_more=rows.len()>100;
    Ok(EntryPage { items:rows.into_iter().take(100).map(|row|decode(&row)).collect::<Result<_,_>>()?,has_more })
}
pub fn create(path: &Path, owner: &TaskOwner, id: &str, kind: &str, title: &str, body: &str, state: &str, pinned: bool) -> Result<Entry,TaskError> {
    owner.validate()?;
    let title=title.trim();
    if !valid_id(id) || !valid_payload(kind,title,body,state,pinned) { return Err(TaskError::InvalidInput); }
    let (db,_) = connect(path)?; let tx=Transaction::begin(&db)?;
    db.query("INSERT INTO workspace_entries(id,project_ref,user_id,kind,title,body,state,pinned) VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(id) DO NOTHING",
        &[id,&owner.project_ref,&owner.user_id,kind,title,body,state,if pinned {"1"} else {"0"}])?;
    let sql=format!("SELECT {FIELDS} FROM workspace_entries WHERE id=?1 AND project_ref=?2 AND user_id=?3 AND kind=?4");
    let rows=db.query(&sql,&[id,&owner.project_ref,&owner.user_id,kind])?;
    let entry=decode(rows.first().ok_or(TaskError::Conflict)?)?;
    if entry.title!=title || entry.body!=body || entry.state!=state || entry.pinned!=pinned || entry.revision!=1 { return Err(TaskError::Conflict); }
    tx.commit()?; Ok(entry)
}
pub fn save(path: &Path, owner: &TaskOwner, id: &str, kind: &str, expected_revision: i64, title: &str, body: &str, state: &str, pinned: bool) -> Result<Entry,TaskError> {
    owner.validate()?;
    let title=title.trim();
    if !valid_id(id) || expected_revision<1 || !valid_payload(kind,title,body,state,pinned) { return Err(TaskError::InvalidInput); }
    let (db,_) = connect(path)?; let tx=Transaction::begin(&db)?;
    let sql=format!("SELECT {FIELDS} FROM workspace_entries WHERE id=?1 AND project_ref=?2 AND user_id=?3 AND kind=?4");
    let rows=db.query(&sql,&[id,&owner.project_ref,&owner.user_id,kind])?;
    let current=decode(rows.first().ok_or(TaskError::NotFound)?)?;
    let same=current.title==title && current.body==body && current.state==state && current.pinned==pinned;
    if same && (current.revision==expected_revision || expected_revision.checked_add(1)==Some(current.revision)) { tx.commit()?; return Ok(current); }
    if current.revision!=expected_revision || current.revision==i64::MAX { return Err(TaskError::Conflict); }
    db.query("UPDATE workspace_entries SET title=?5,body=?6,state=?7,pinned=?8,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1 AND project_ref=?2 AND user_id=?3 AND kind=?4 AND revision=?9",
        &[id,&owner.project_ref,&owner.user_id,kind,title,body,state,if pinned {"1"} else {"0"},&expected_revision.to_string()])?;
    let rows=db.query(&sql,&[id,&owner.project_ref,&owner.user_id,kind])?;
    let entry=decode(rows.first().ok_or(StorageError::InvalidSchema)?)?;
    if entry.revision!=expected_revision+1 { return Err(TaskError::Conflict); }
    tx.commit()?; Ok(entry)
}
pub fn delete(path: &Path, owner: &TaskOwner, id: &str, kind: &str, expected_revision: i64) -> Result<(),TaskError> {
    owner.validate()?;
    if !valid_id(id) || !matches!(kind,"note"|"project") || expected_revision<1 { return Err(TaskError::InvalidInput); }
    let (db,_) = connect(path)?; let tx=Transaction::begin(&db)?;
    let rows=db.query("SELECT revision FROM workspace_entries WHERE id=?1 AND project_ref=?2 AND user_id=?3 AND kind=?4", &[id,&owner.project_ref,&owner.user_id,kind])?;
    if let Some(row)=rows.first() {
        if row[0]!=expected_revision.to_string() { return Err(TaskError::Conflict); }
        if kind=="project" { db.query("UPDATE task_attributes SET project_id=NULL WHERE project_id=?1 AND project_ref=?2 AND user_id=?3",&[id,&owner.project_ref,&owner.user_id])?; }
        db.query("DELETE FROM workspace_entries WHERE id=?1 AND project_ref=?2 AND user_id=?3 AND kind=?4 AND revision=?5",
            &[id,&owner.project_ref,&owner.user_id,kind,&expected_revision.to_string()])?;
    }
    tx.commit()?; Ok(())
}

pub fn get_entry(path:&Path,owner:&TaskOwner,kind:&str,id:&str)->Result<Entry,TaskError>{
 owner.validate()?;if !valid_id(id)||!matches!(kind,"note"|"project"){return Err(TaskError::InvalidInput)}
 let(db,_)=connect(path)?;let rows=db.query(&format!("SELECT {FIELDS} FROM workspace_entries WHERE project_ref=?1 AND user_id=?2 AND kind=?3 AND id=?4"),&[&owner.project_ref,&owner.user_id,kind,id])?;
 decode(rows.first().ok_or(TaskError::NotFound)?)
}
