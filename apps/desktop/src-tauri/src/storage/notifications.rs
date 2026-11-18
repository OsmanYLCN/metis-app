use super::{connect,tasks::{TaskError,TaskOwner},StorageError};
use serde::Serialize;
use std::path::Path;
#[derive(Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct NotificationState { pub source_kind:String,pub source_id:String,pub due_date:String,pub is_read:bool,pub snoozed_until:Option<String> }
fn valid_id(s:&str)->bool{s.len()==32&&s!="00000000000000000000000000000000"&&s.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase())}
fn date(s:&str)->bool{let p:Vec<_>=s.split('-').collect();if p.len()!=3||p[0].len()!=4||p[1].len()!=2||p[2].len()!=2{return false}let(Ok(y),Ok(m),Ok(d))=(p[0].parse::<u32>(),p[1].parse::<u32>(),p[2].parse::<u32>())else{return false};let leap=y%4==0&&(y%100!=0||y%400==0);let max=match m{1|3|5|7|8|10|12=>31,4|6|9|11=>30,2 if leap=>29,2=>28,_=>return false};d>0&&d<=max}
fn valid(kind:&str,id:&str,due:&str,snooze:Option<&str>)->bool{matches!(kind,"task"|"event"|"goal")&&valid_id(id)&&date(due)&&snooze.is_none_or(date)}
pub fn list(path:&Path,owner:&TaskOwner)->Result<Vec<NotificationState>,TaskError>{owner.validate()?;let(db,_)=connect(path)?;db.query("SELECT source_kind,source_id,due_date,is_read,COALESCE(snoozed_until,'') FROM notification_state WHERE project_ref=?1 AND user_id=?2 ORDER BY due_date DESC LIMIT 2000",&[&owner.project_ref,&owner.user_id])?.into_iter().map(|r|{if r.len()!=5||!valid(&r[0],&r[1],&r[2],(!r[4].is_empty()).then_some(r[4].as_str()))||!matches!(r[3].as_str(),"0"|"1"){return Err(StorageError::InvalidSchema.into())}Ok(NotificationState{source_kind:r[0].clone(),source_id:r[1].clone(),due_date:r[2].clone(),is_read:r[3]=="1",snoozed_until:(!r[4].is_empty()).then(||r[4].clone())})}).collect()}
pub fn set(path:&Path,owner:&TaskOwner,kind:&str,id:&str,due:&str,read:bool,snooze:Option<&str>)->Result<(),TaskError>{owner.validate()?;if !valid(kind,id,due,snooze){return Err(TaskError::InvalidInput)}let(db,_)=connect(path)?;db.query("INSERT INTO notification_state(project_ref,user_id,source_kind,source_id,due_date,is_read,snoozed_until) VALUES(?1,?2,?3,?4,?5,?6,NULLIF(?7,'')) ON CONFLICT(project_ref,user_id,source_kind,source_id,due_date) DO UPDATE SET is_read=excluded.is_read,snoozed_until=excluded.snoozed_until",&[&owner.project_ref,&owner.user_id,kind,id,due,if read{"1"}else{"0"},snooze.unwrap_or("")])?;Ok(())}

#[derive(Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Reminder {pub kind:String,pub id:String,pub title:String,pub due:String,pub time:String,pub is_read:bool,pub snoozed_until:Option<String>}
#[derive(Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct ReminderPage {pub items:Vec<Reminder>,pub total:usize,pub unread:usize,pub has_more:bool}
pub fn page(path:&Path,owner:&TaskOwner,today:&str,to:&str,query:&str,kind:&str,mode:&str,offset:u32)->Result<ReminderPage,TaskError>{
 owner.validate()?;if !date(today)||!date(to)||to<today||query.chars().count()>100||!matches!(kind,"all"|"task"|"event"|"goal")||!matches!(mode,"new"|"all"|"snoozed"|"overdue"){return Err(TaskError::InvalidInput)}
 let(db,_)=connect(path)?;
 let rows=db.query("WITH sources AS (
 SELECT 'task' AS kind,t.id,t.title,a.due_date AS due,'' AS time FROM tasks t JOIN task_attributes a ON a.task_id=t.id WHERE t.project_ref=?1 AND t.user_id=?2 AND t.completed=0 AND a.due_date<=?4
 UNION ALL SELECT 'goal',id,title,target_date,'' FROM goals WHERE project_ref=?1 AND user_id=?2 AND state='active' AND target_date<=?4
 UNION ALL SELECT 'event',id,title,event_date,COALESCE(start_time,'') FROM calendar_events WHERE project_ref=?1 AND user_id=?2 AND event_date>=?3 AND event_date<=?4
 ) SELECT s.kind,s.id,s.title,s.due,s.time,COALESCE(n.is_read,0),COALESCE(n.snoozed_until,'') FROM sources s LEFT JOIN notification_state n ON n.project_ref=?1 AND n.user_id=?2 AND n.source_kind=s.kind AND n.source_id=s.id AND n.due_date=s.due WHERE (?5='all' OR s.kind=?5) ORDER BY s.due,s.time,s.title,s.kind,s.id",&[&owner.project_ref,&owner.user_id,today,to,kind])?;
 let fold=|s:&str|s.replace('I',"ı").replace('İ',"i").to_lowercase();let needle=fold(query.trim());let mut items=Vec::new();let mut unread=0;
 for r in rows{
  if r.len()!=7||!valid(&r[0],&r[1],&r[3],(!r[6].is_empty()).then_some(r[6].as_str()))||!matches!(r[5].as_str(),"0"|"1"){return Err(StorageError::InvalidSchema.into())}
  if !fold(&r[2]).contains(&needle){continue}
  let snoozed=!r[6].is_empty()&&r[6].as_str()>today;let read=r[5]=="1";if !read&&!snoozed{unread+=1}
  let include=match mode{"snoozed"=>snoozed,"new"=>!read&&!snoozed,"overdue"=>!read&&!snoozed&&r[3].as_str()<today,_=>true};
  if include{items.push(Reminder{kind:r[0].clone(),id:r[1].clone(),title:r[2].clone(),due:r[3].clone(),time:r[4].clone(),is_read:read,snoozed_until:(!r[6].is_empty()).then(||r[6].clone())})}
 }
 let total=items.len();Ok(ReminderPage{items:items.into_iter().skip(offset as usize).take(50).collect(),total,unread,has_more:total.saturating_sub(offset as usize)>50})
}
