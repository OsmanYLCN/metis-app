use super::{connect, sqlite::Transaction, tasks::{TaskError,TaskOwner}, StorageError};
use serde::Serialize;
use std::path::Path;

#[derive(Debug,Serialize,PartialEq)]
#[serde(rename_all="camelCase")]
pub struct Goal { pub id:String,pub title:String,pub description:String,pub state:String,pub target_date:Option<String>,pub progress:u8,pub revision:i64,pub created_at:String,pub updated_at:String }

fn id(value:&str)->bool { value.len()==32 && value!="00000000000000000000000000000000" && value.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase()) }
fn date(value:&str)->bool { let p:Vec<_>=value.split('-').collect(); if p.len()!=3||p[0].len()!=4||p[1].len()!=2||p[2].len()!=2{return false} let (Ok(y),Ok(m),Ok(d))=(p[0].parse::<u32>(),p[1].parse::<u32>(),p[2].parse::<u32>()) else{return false}; let leap=y%4==0&&(y%100!=0||y%400==0); let max=match m{1|3|5|7|8|10|12=>31,4|6|9|11=>30,2 if leap=>29,2=>28,_=>return false}; d>0&&d<=max }
fn valid(title:&str,description:&str,state:&str,target:Option<&str>,progress:u8)->bool { !title.is_empty()&&title.chars().count()<=200&&!title.chars().any(char::is_control)&&description.chars().count()<=10000&&!description.chars().any(|c|c.is_control()&&!matches!(c,'\n'|'\r'|'\t'))&&matches!(state,"active"|"paused"|"done")&&target.is_none_or(date)&&progress<=100 }
const FIELDS:&str="id,title,description,state,COALESCE(target_date,''),progress,revision,created_at,updated_at";
fn decode(row:&[String])->Result<Goal,TaskError>{ if row.len()!=9||!id(&row[0]){return Err(StorageError::InvalidSchema.into())} let progress=row[5].parse().map_err(|_|StorageError::InvalidSchema)?; let revision=row[6].parse().map_err(|_|StorageError::InvalidSchema)?; if revision<1||!valid(&row[1],&row[2],&row[3],(!row[4].is_empty()).then_some(row[4].as_str()),progress){return Err(StorageError::InvalidSchema.into())} Ok(Goal{id:row[0].clone(),title:row[1].clone(),description:row[2].clone(),state:row[3].clone(),target_date:(!row[4].is_empty()).then(||row[4].clone()),progress,revision,created_at:row[7].clone(),updated_at:row[8].clone()}) }
fn get(db:&super::sqlite::Connection,owner:&TaskOwner,id_value:&str)->Result<Goal,TaskError>{ let rows=db.query(&format!("SELECT {FIELDS} FROM goals WHERE id=?1 AND project_ref=?2 AND user_id=?3"),&[id_value,&owner.project_ref,&owner.user_id])?; decode(rows.first().ok_or(TaskError::NotFound)?) }

pub fn list(path:&Path,owner:&TaskOwner)->Result<Vec<Goal>,TaskError>{ owner.validate()?;let(db,_)=connect(path)?;db.query(&format!("SELECT {FIELDS} FROM goals WHERE project_ref=?1 AND user_id=?2 ORDER BY CASE state WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,target_date IS NULL,target_date,updated_at DESC LIMIT 200"),&[&owner.project_ref,&owner.user_id])?.into_iter().map(|row|decode(&row)).collect() }
pub fn create(path:&Path,owner:&TaskOwner,id_value:&str,title:&str,description:&str,state:&str,target:Option<&str>,progress:u8)->Result<Goal,TaskError>{ owner.validate()?;let title=title.trim();if !id(id_value)||!valid(title,description,state,target,progress){return Err(TaskError::InvalidInput)}let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;db.query("INSERT INTO goals(id,project_ref,user_id,title,description,state,target_date,progress) VALUES(?1,?2,?3,?4,?5,?6,NULLIF(?7,''),?8) ON CONFLICT(id) DO NOTHING",&[id_value,&owner.project_ref,&owner.user_id,title,description,state,target.unwrap_or(""),&progress.to_string()])?;let goal=get(&db,owner,id_value).map_err(|e|if e==TaskError::NotFound{TaskError::Conflict}else{e})?;if goal.title!=title||goal.description!=description||goal.state!=state||goal.target_date.as_deref()!=target||goal.progress!=progress{return Err(TaskError::Conflict)}tx.commit()?;Ok(goal) }
pub fn save(path:&Path,owner:&TaskOwner,id_value:&str,expected:i64,title:&str,description:&str,state:&str,target:Option<&str>,progress:u8)->Result<Goal,TaskError>{ owner.validate()?;let title=title.trim();if !id(id_value)||expected<1||!valid(title,description,state,target,progress){return Err(TaskError::InvalidInput)}let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;let current=get(&db,owner,id_value)?;let same=current.title==title&&current.description==description&&current.state==state&&current.target_date.as_deref()==target&&current.progress==progress;if same&&(current.revision==expected||expected.checked_add(1)==Some(current.revision)){tx.commit()?;return Ok(current)}if current.revision!=expected{return Err(TaskError::Conflict)}db.query("UPDATE goals SET title=?4,description=?5,state=?6,target_date=NULLIF(?7,''),progress=?8,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1 AND project_ref=?2 AND user_id=?3 AND revision=?9",&[id_value,&owner.project_ref,&owner.user_id,title,description,state,target.unwrap_or(""),&progress.to_string(),&expected.to_string()])?;let goal=get(&db,owner,id_value)?;tx.commit()?;Ok(goal) }
pub fn delete(path:&Path,owner:&TaskOwner,id_value:&str,expected:i64)->Result<(),TaskError>{ owner.validate()?;if !id(id_value)||expected<1{return Err(TaskError::InvalidInput)}let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;let rows=db.query("SELECT revision FROM goals WHERE id=?1 AND project_ref=?2 AND user_id=?3",&[id_value,&owner.project_ref,&owner.user_id])?;if let Some(row)=rows.first(){if row[0]!=expected.to_string(){return Err(TaskError::Conflict)}db.query("DELETE FROM goals WHERE id=?1 AND project_ref=?2 AND user_id=?3",&[id_value,&owner.project_ref,&owner.user_id])?;}tx.commit()?;Ok(())}

pub fn get_record(path:&Path,owner:&TaskOwner,key:&str)->Result<Goal,TaskError>{owner.validate()?;if !id(key){return Err(TaskError::InvalidInput)}let(db,_)=connect(path)?;get(&db,owner,key)}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct GoalPage {pub items:Vec<Goal>,pub total:usize,pub has_more:bool}
pub fn page(path:&Path,owner:&TaskOwner,query:&str,state:&str,sort:&str,offset:u32)->Result<GoalPage,TaskError>{
 owner.validate()?;if query.chars().count()>100||!matches!(state,"all"|"active"|"paused"|"done")||!matches!(sort,"date"|"progress"|"title"){return Err(TaskError::InvalidInput)}
 let(db,_)=connect(path)?;let order=match sort{"progress"=>"progress DESC,id","title"=>"title COLLATE NOCASE,id",_=>"target_date IS NULL,target_date,id"};
 let fold=|s:&str|s.replace('I',"ı").replace('İ',"i").to_lowercase();let needle=fold(query.trim());let mut results=Vec::new();
 for row in db.query(&format!("SELECT {FIELDS} FROM goals WHERE project_ref=?1 AND user_id=?2 AND (?3='all' OR state=?3) ORDER BY {order}"),&[&owner.project_ref,&owner.user_id,state])?{let goal=decode(&row)?;if fold(&format!("{} {}",goal.title,goal.description)).contains(&needle){results.push(goal)}}
 let total=results.len();Ok(GoalPage{items:results.into_iter().skip(offset as usize).take(100).collect(),total,has_more:total.saturating_sub(offset as usize)>100})
}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct GoalSummary { pub total:u64, pub active:u64, pub paused:u64, pub done:u64, pub overdue:u64, pub average_progress:u64, pub upcoming:Vec<Goal> }
pub fn summary(path:&Path,owner:&TaskOwner,today:&str)->Result<GoalSummary,TaskError>{
 owner.validate()?;if !date(today){return Err(TaskError::InvalidInput)}
 let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;
 let rows=db.query("SELECT COUNT(*),COALESCE(SUM(state='active'),0),COALESCE(SUM(state='paused'),0),COALESCE(SUM(state='done'),0),COALESCE(SUM(state='active' AND target_date<?3),0),COALESCE(CAST(ROUND(AVG(CASE WHEN state='active' THEN progress END)) AS INTEGER),0) FROM goals WHERE project_ref=?1 AND user_id=?2",&[&owner.project_ref,&owner.user_id,today])?;
 let row=rows.first().ok_or(StorageError::InvalidSchema)?;
 let n=|i:usize|->Result<u64,TaskError>{row.get(i).ok_or(StorageError::InvalidSchema)?.parse().map_err(|_|StorageError::InvalidSchema.into())};
 let upcoming=db.query(&format!("SELECT {FIELDS} FROM goals WHERE project_ref=?1 AND user_id=?2 AND state='active' ORDER BY target_date IS NULL,target_date,id LIMIT 5"),&[&owner.project_ref,&owner.user_id])?.into_iter().map(|row|decode(&row)).collect::<Result<Vec<_>,_>>()?;
 let result=GoalSummary{total:n(0)?,active:n(1)?,paused:n(2)?,done:n(3)?,overdue:n(4)?,average_progress:n(5)?,upcoming};tx.commit()?;Ok(result)
}
