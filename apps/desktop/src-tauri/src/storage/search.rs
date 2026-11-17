use super::{connect, tasks::{TaskOwner, TaskError}, StorageError};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct SearchItem { pub id:String,pub title:String,pub text:String,pub kind:String,pub route:String,pub date:String }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct SearchPage { pub items:Vec<SearchItem>,pub total:usize,pub has_more:bool }
fn fold(value:&str)->String { value.replace('I',"ı").replace('İ',"i").to_lowercase() }

pub fn search(path:&Path,owner:&TaskOwner,query:&str,kind:&str,offset:u32)->Result<SearchPage,TaskError>{
 owner.validate()?;
 if query.chars().count()>100||query.chars().any(char::is_control)||!matches!(kind,"all"|"task"|"note"|"project"|"goal"|"event"|"finance"){return Err(TaskError::InvalidInput)}
 let needle=fold(query.trim());
 if needle.is_empty(){return Ok(SearchPage{items:vec![],total:0,has_more:false})}
 let(db,_)=connect(path)?;
 let sources=[
 ("task","Tasks","SELECT id,title,'',updated_at FROM tasks WHERE project_ref=?1 AND user_id=?2"),
 ("note","Notes","SELECT id,title,body,updated_at FROM workspace_entries WHERE project_ref=?1 AND user_id=?2 AND kind='note'"),
 ("project","Projects","SELECT id,title,body,updated_at FROM workspace_entries WHERE project_ref=?1 AND user_id=?2 AND kind='project'"),
 ("goal","Goals","SELECT id,title,description,updated_at FROM goals WHERE project_ref=?1 AND user_id=?2"),
 ("event","Calendar","SELECT id,title,details,event_date FROM calendar_events WHERE project_ref=?1 AND user_id=?2"),
 ("finance","Finance","SELECT id,title,category,entry_date FROM finance_entries WHERE project_ref=?1 AND user_id=?2")];
 let mut matches=Vec::new();
 for (source,route,sql) in sources {
  if kind!="all"&&kind!=source{continue}
  for row in db.query(sql,&[&owner.project_ref,&owner.user_id])? {
   if row.len()!=4{return Err(StorageError::InvalidSchema.into())}
   let title=fold(&row[1]);
   if !title.contains(&needle)&&!fold(&row[2]).contains(&needle){continue}
   let rank=if title==needle{0}else if title.starts_with(&needle){1}else if title.contains(&needle){2}else{3};
   matches.push((rank,SearchItem{id:row[0].clone(),title:row[1].clone(),text:row[2].chars().take(160).collect(),kind:source.into(),route:route.into(),date:row[3].clone()}));
  }
 }
 matches.sort_by(|a,b|a.0.cmp(&b.0).then(b.1.date.cmp(&a.1.date)).then(a.1.kind.cmp(&b.1.kind)).then(a.1.id.cmp(&b.1.id)));
 let total=matches.len();let start=offset as usize;
 Ok(SearchPage{items:matches.into_iter().skip(start).take(50).map(|(_,item)|item).collect(),total,has_more:total.saturating_sub(start)>50})
}
