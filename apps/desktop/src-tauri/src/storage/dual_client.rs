
use super::{inbox,merge,outbound,workspace,tasks::TaskOwner};
use serde_json::{Value,json};
use std::io::{BufRead,Write};
#[test]
fn isolated_client_bridge(){
 let Ok(root)=std::env::var("METIS_DUAL_CLIENT_ROOT")else{return};
 let root=std::fs::canonicalize(root).unwrap();
 assert!(root.components().any(|p|p.as_os_str()=="test-results"));
 assert!(root.file_name().unwrap().to_string_lossy().starts_with("dual-client-"));
 let path=root.join("local.sqlite3");
 let o=TaskOwner{project_ref:"test-project".into(),user_id:"11111111-1111-4111-8111-111111111111".into()};
 for line in std::io::stdin().lock().lines(){
  let input:Value=serde_json::from_str(&line.unwrap()).unwrap();let cmd=input["cmd"].as_str().unwrap();
  if cmd=="exit"{break}
  let field=|k:&str|input[k].as_str().unwrap_or("");
  let result=(||->Result<Value,super::tasks::TaskError>{Ok(match cmd{
   "create"=>serde_json::to_value(workspace::create(&path,&o,field("id"),"note",field("title"),field("body"),"active",false)?).unwrap(),
   "edit"=>{let e=workspace::get_entry(&path,&o,"note",field("id"))?;serde_json::to_value(workspace::save(&path,&o,field("id"),"note",e.revision,field("title"),field("body"),"active",false)?).unwrap()},
   "delete"=>{let e=workspace::get_entry(&path,&o,"note",field("id"))?;workspace::delete(&path,&o,field("id"),"note",e.revision)?;json!(null)},
   "list"=>serde_json::to_value(workspace::list(&path,&o,"note","",0)?).unwrap(),
   "prepare"=>{let item=outbound::list(&path,&o,0)?.into_iter().find(|i|i.id==field("id")).ok_or(super::tasks::TaskError::NotFound)?;serde_json::to_value(outbound::prepare(&path,&o,"note",&item.id,&item.digest,"","")?).unwrap()},
   "delete_prepare"=>{let item=outbound::removed(&path,&o,0)?.into_iter().find(|i|i.id==field("id")).ok_or(super::tasks::TaskError::NotFound)?;serde_json::to_value(outbound::prepare_delete(&path,&o,"note",&item.id,&item.digest)?).unwrap()},
   "ack"=>{outbound::acknowledge(&path,&o,"note",field("id"),field("operation"),input["revision"].as_i64().unwrap())?;json!(null)},
   "reject"=>{outbound::reject(&path,&o,"note",field("id"),field("operation"))?;json!(null)},
   "status"=>serde_json::to_value(inbox::status(&path,&o)?).unwrap(),
   "stage"=>serde_json::to_value(inbox::stage(&path,&o,field("expected"),serde_json::from_value(input["page"].clone()).unwrap())?).unwrap(),
   "merge"=>serde_json::to_value(merge::run(&path,&o,0)?).unwrap(),
   "conflicts"=>serde_json::to_value(merge::conflicts(&path,&o,0)?).unwrap(),
   "resolve"=>{merge::resolve(&path,&o,"note",field("id"),field("digest"),field("choice"))?;json!(null)},
   _=>return Err(super::tasks::TaskError::InvalidInput)
  })})();
  let reply=match result{Ok(v)=>json!({"ok":true,"value":v}),Err(e)=>json!({"ok":false,"error":e})};
  println!("METIS_RESULT:{reply}");std::io::stdout().flush().unwrap();
 }
}

#[test]
fn grouped_merge_never_synthesizes_finance_or_invalid_time_ranges(){
 let b=json!({"title":"Note","body":"Body","pinned":false,"state":"active"});
 let mut l=b.clone();l["title"]=json!("Local");
 let mut r=b.clone();r["body"]=json!("Remote");
 let merged=merge::combine("note",&Some(b.clone()),&Some(l.clone()),&Some(r.clone()),true).unwrap().unwrap();
 assert_eq!(merged["title"],"Local");assert_eq!(merged["body"],"Remote");
 r["title"]=json!("Other");assert!(merge::combine("note",&Some(b.clone()),&Some(l),&Some(r),true).is_err());
 assert!(merge::combine("finance",&Some(json!({"amountCents":100,"category":"A"})),&Some(json!({"amountCents":200,"category":"A"})),&Some(json!({"amountCents":100,"category":"B"})),true).is_err());
 let b=json!({"title":"Event","details":"","eventDate":"2026-12-01","startTime":"09:00","endTime":"12:00"});
 let mut l=b.clone();l["startTime"]=json!("11:00");let mut r=b.clone();r["endTime"]=json!("10:00");
 assert!(merge::combine("event",&Some(b),&Some(l),&Some(r),true).is_err());
 assert!(merge::combine("note",&Some(json!({})),&Some(json!({"body":"edited"})),&None,true).is_err());
}


struct Temp(std::path::PathBuf);
impl Temp{
 fn new()->Self{let p=std::env::temp_dir().join(format!("metis-merge-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));std::fs::create_dir(&p).unwrap();Self(p)}
 fn db(&self)->std::path::PathBuf{self.0.join("local.sqlite3")}
}
impl Drop for Temp{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
fn owner()->TaskOwner{TaskOwner{project_ref:"test-project".into(),user_id:"11111111-1111-4111-8111-111111111111".into()}}
fn task_page(o:&TaskOwner,key:&str,pos:u32,revision:u32,title:&str,priority:u32)->inbox::Page{
 inbox::Page{contract_version:1,items:vec![inbox::Change{position:pos.to_string(),entity:"task".into(),entity_id:key.into(),revision:revision as i64,deleted:false,snapshot:json!({"id":key,"revision":revision,"title":title,"completed":false,"projectId":null,"dueDate":null,"priority":priority,"deletedAt":null})}],next_cursor:format!("{}.{}.{}","a".repeat(32),o.user_id.replace('-',""),pos),has_more:false}
}
#[test]
fn task_merge_rebases_unsent_title_and_later_completion_without_losing_plan(){
 use super::{outbox,tasks};
 let t=Temp::new();let path=t.db();let o=owner();let key="b".repeat(32);
 let first=inbox::stage(&path,&o,"",task_page(&o,&key,1,1,"Base",0)).unwrap();
 assert_eq!(merge::run(&path,&o,0).unwrap().applied,1);
 tasks::rename(&path,&o,&key,"Local","Base").unwrap();
 inbox::stage(&path,&o,&first.cursor,task_page(&o,&key,2,2,"Base",3)).unwrap();
 assert_eq!(merge::run(&path,&o,0).unwrap().applied,1);
 let local=tasks::list(&path,&o,0).unwrap().items.remove(0);assert_eq!(local.title,"Local");assert_eq!(local.priority,3);
 let op=outbox::pending(&path,&o,0).unwrap().remove(0);assert_eq!(op.expected_revision,2);assert_eq!(op.title,"Local");
 outbox::begin_delivery(&path,&o,op.sequence).unwrap();outbox::acknowledge(&path,&o,&op.operation_id,&key,3,"applied").unwrap();
 assert_eq!(outbox::count(&path,&o).unwrap(),0);
}
#[test]
fn uncertain_task_is_not_rebased_until_exact_rejection_is_recorded(){
 use super::{outbox,tasks};
 let t=Temp::new();let path=t.db();let o=owner();let key="c".repeat(32);
 let first=inbox::stage(&path,&o,"",task_page(&o,&key,1,1,"Base",0)).unwrap();merge::run(&path,&o,0).unwrap();
 tasks::rename(&path,&o,&key,"Local","Base").unwrap();
 let op=outbox::pending(&path,&o,0).unwrap().remove(0);outbox::begin_delivery(&path,&o,op.sequence).unwrap();
 inbox::stage(&path,&o,&first.cursor,task_page(&o,&key,2,2,"Remote",0)).unwrap();
 assert_eq!(merge::run(&path,&o,0).unwrap().deferred,1);assert!(merge::conflicts(&path,&o,0).unwrap().is_empty());
 outbox::reject(&path,&o,&"d".repeat(32),&key).unwrap();assert_eq!(merge::run(&path,&o,0).unwrap().deferred,1);
 outbox::reject(&path,&o,&op.operation_id,&key).unwrap();assert_eq!(merge::run(&path,&o,0).unwrap().conflicts,1);
 let conflict=merge::conflicts(&path,&o,0).unwrap().remove(0);
 merge::resolve(&path,&o,"task",&key,&conflict.digest,"local").unwrap();
 let new=outbox::pending(&path,&o,0).unwrap().remove(0);assert_ne!(new.operation_id,op.operation_id);assert_eq!(new.expected_revision,2);
}
#[test]
fn task_merge_queues_completion_after_rebased_title_receipt(){
 use super::{outbox,tasks};
 let t=Temp::new();let path=t.db();let o=owner();let key="d".repeat(32);
 let first=inbox::stage(&path,&o,"",task_page(&o,&key,1,1,"Base",0)).unwrap();merge::run(&path,&o,0).unwrap();
 outbox::prepare_action(&path,&o,&key,"complete",Some(true)).unwrap();
 // Remote title and local completion are independent intents.
 inbox::stage(&path,&o,&first.cursor,task_page(&o,&key,2,2,"Remote",2)).unwrap();
 assert_eq!(merge::run(&path,&o,0).unwrap().applied,1);
 let action=outbox::pending_actions(&path,&o).unwrap().remove(0);assert_eq!(action.expected_revision,2);assert_eq!(action.completed,Some(true));
 let local=tasks::list(&path,&o,0).unwrap().items.remove(0);assert_eq!(local.title,"Remote");assert!(local.completed);assert_eq!(local.priority,2);
 outbox::begin_action(&path,&o,&action.operation_id).unwrap();outbox::acknowledge_action(&path,&o,&action.operation_id,&key,3).unwrap();
}
