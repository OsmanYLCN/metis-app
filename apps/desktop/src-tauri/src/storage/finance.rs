use super::{connect,sqlite::Transaction,tasks::{TaskError,TaskOwner},StorageError};
use serde::Serialize;
use std::path::Path;

#[derive(Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct FinanceEntry { pub id:String,pub kind:String,pub title:String,pub category:String,pub amount_cents:i64,pub entry_date:String,pub created_at:String }
#[derive(Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Budget { pub month:String,pub category:String,pub limit_cents:i64,pub spent_cents:i64 }
fn valid_id(s:&str)->bool{s.len()==32&&s!="00000000000000000000000000000000"&&s.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase())}
fn valid_date(s:&str)->bool{let p:Vec<_>=s.split('-').collect();if p.len()!=3||p[0].len()!=4||p[1].len()!=2||p[2].len()!=2{return false}let(Ok(y),Ok(m),Ok(d))=(p[0].parse::<u32>(),p[1].parse::<u32>(),p[2].parse::<u32>())else{return false};let leap=y%4==0&&(y%100!=0||y%400==0);let max=match m{1|3|5|7|8|10|12=>31,4|6|9|11=>30,2 if leap=>29,2=>28,_=>return false};d>0&&d<=max}
fn valid(kind:&str,title:&str,category:&str,cents:i64,date:&str)->bool{matches!(kind,"income"|"expense")&&!title.is_empty()&&title.chars().count()<=200&&!title.chars().any(char::is_control)&&!category.is_empty()&&category.chars().count()<=60&&!category.chars().any(char::is_control)&&(1..=999999999999).contains(&cents)&&valid_date(date)}
fn decode(row:Vec<String>)->Result<FinanceEntry,TaskError>{if row.len()!=7||!valid_id(&row[0]){return Err(StorageError::InvalidSchema.into())}let cents=row[4].parse().map_err(|_|StorageError::InvalidSchema)?;if !valid(&row[1],&row[2],&row[3],cents,&row[5]){return Err(StorageError::InvalidSchema.into())}Ok(FinanceEntry{id:row[0].clone(),kind:row[1].clone(),title:row[2].clone(),category:row[3].clone(),amount_cents:cents,entry_date:row[5].clone(),created_at:row[6].clone()})}
const FIELDS:&str="id,kind,title,category,amount_cents,entry_date,created_at";
pub fn list(path:&Path,owner:&TaskOwner,month:&str)->Result<Vec<FinanceEntry>,TaskError>{owner.validate()?;if month.len()!=7||!valid_date(&format!("{month}-01")){return Err(TaskError::InvalidInput)}let(db,_)=connect(path)?;db.query(&format!("SELECT {FIELDS} FROM finance_entries WHERE project_ref=?1 AND user_id=?2 AND substr(entry_date,1,7)=?3 ORDER BY entry_date DESC,created_at DESC,id DESC LIMIT 500"),&[&owner.project_ref,&owner.user_id,month])?.into_iter().map(decode).collect()}
pub fn create(path:&Path,owner:&TaskOwner,id:&str,kind:&str,title:&str,category:&str,cents:i64,date:&str)->Result<FinanceEntry,TaskError>{owner.validate()?;let title=title.trim();let category=category.trim();if !valid_id(id)||!valid(kind,title,category,cents,date){return Err(TaskError::InvalidInput)}let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;db.query("INSERT INTO finance_entries(id,project_ref,user_id,kind,title,category,amount_cents,entry_date) VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(id) DO NOTHING",&[id,&owner.project_ref,&owner.user_id,kind,title,category,&cents.to_string(),date])?;let rows=db.query(&format!("SELECT {FIELDS} FROM finance_entries WHERE id=?1 AND project_ref=?2 AND user_id=?3"),&[id,&owner.project_ref,&owner.user_id])?;let entry=decode(rows.into_iter().next().ok_or(TaskError::Conflict)?)?;if entry.kind!=kind||entry.title!=title||entry.category!=category||entry.amount_cents!=cents||entry.entry_date!=date{return Err(TaskError::Conflict)}tx.commit()?;Ok(entry)}
pub fn delete(path:&Path,owner:&TaskOwner,id:&str)->Result<(),TaskError>{owner.validate()?;if !valid_id(id){return Err(TaskError::InvalidInput)}let(db,_)=connect(path)?;db.query("DELETE FROM finance_entries WHERE id=?1 AND project_ref=?2 AND user_id=?3",&[id,&owner.project_ref,&owner.user_id])?;Ok(())}
pub fn budgets(path:&Path,owner:&TaskOwner,month:&str)->Result<Vec<Budget>,TaskError>{owner.validate()?;if month.len()!=7||!valid_date(&format!("{month}-01")){return Err(TaskError::InvalidInput)}let(db,_)=connect(path)?;db.query("SELECT b.month,b.category,b.limit_cents,COALESCE((SELECT SUM(e.amount_cents) FROM finance_entries e WHERE e.project_ref=b.project_ref AND e.user_id=b.user_id AND substr(e.entry_date,1,7)=b.month AND e.kind='expense' AND e.category=b.category),0) FROM finance_budgets b WHERE b.project_ref=?1 AND b.user_id=?2 AND b.month=?3 ORDER BY b.category LIMIT 200",&[&owner.project_ref,&owner.user_id,month])?.into_iter().map(|row|{if row.len()!=4{return Err(StorageError::InvalidSchema.into())}let cents=row[2].parse().map_err(|_|StorageError::InvalidSchema)?;let spent=row[3].parse().map_err(|_|StorageError::InvalidSchema)?;Ok(Budget{month:row[0].clone(),category:row[1].clone(),limit_cents:cents,spent_cents:spent})}).collect()}
pub fn set_budget(path:&Path,owner:&TaskOwner,month:&str,category:&str,cents:i64)->Result<(),TaskError>{owner.validate()?;let category=category.trim();if month.len()!=7||!valid_date(&format!("{month}-01"))||category.is_empty()||category.chars().count()>60||category.chars().any(char::is_control)||!(0..=999999999999).contains(&cents){return Err(TaskError::InvalidInput)}let(db,_)=connect(path)?;if cents==0{db.query("DELETE FROM finance_budgets WHERE project_ref=?1 AND user_id=?2 AND month=?3 AND category=?4",&[&owner.project_ref,&owner.user_id,month,category])?;}else{db.query("INSERT INTO finance_budgets(project_ref,user_id,month,category,limit_cents) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(project_ref,user_id,month,category) DO UPDATE SET limit_cents=excluded.limit_cents",&[&owner.project_ref,&owner.user_id,month,category,&cents.to_string()])?;}Ok(())}

#[derive(Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct FinanceTotal { pub kind:String,pub category:String,pub amount_cents:i64,pub count:i64 }
pub fn totals(path:&Path,owner:&TaskOwner,month:&str)->Result<Vec<FinanceTotal>,TaskError>{
 owner.validate()?;
 if month.len()!=7||!valid_date(&format!("{month}-01")){return Err(TaskError::InvalidInput)}
 let(db,_)=connect(path)?;
 db.query("SELECT kind,category,SUM(amount_cents),COUNT(*) FROM finance_entries WHERE project_ref=?1 AND user_id=?2 AND substr(entry_date,1,7)=?3 GROUP BY kind,category",&[&owner.project_ref,&owner.user_id,month])?.into_iter().map(|row|{
 if row.len()!=4{return Err(StorageError::InvalidSchema.into())}
 Ok(FinanceTotal{kind:row[0].clone(),category:row[1].clone(),amount_cents:row[2].parse().map_err(|_|StorageError::InvalidSchema)?,count:row[3].parse().map_err(|_|StorageError::InvalidSchema)?})
 }).collect()
}

#[derive(Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct FinancePage { pub items:Vec<FinanceEntry>,pub has_more:bool }
pub fn page(path:&Path,owner:&TaskOwner,month:&str,query:&str,kind:&str,offset:u32)->Result<FinancePage,TaskError>{
 owner.validate()?;if month.len()!=7||!valid_date(&format!("{month}-01"))||query.chars().count()>200||!matches!(kind,"all"|"income"|"expense"){return Err(TaskError::InvalidInput)}
 let(db,_)=connect(path)?;let fold=|s:&str|s.replace('I',"ı").replace('İ',"i").to_lowercase();let needle=fold(query.trim());
 let mut sql=format!("SELECT {FIELDS} FROM finance_entries WHERE project_ref=?1 AND user_id=?2 AND substr(entry_date,1,7)=?3 AND (?4='all' OR kind=?4) ORDER BY entry_date DESC,created_at DESC,id DESC");
 if needle.is_empty(){sql.push_str(&format!(" LIMIT 101 OFFSET {offset}"));}
 let mut items=Vec::new();let mut skipped=0;
 for row in db.query(&sql,&[&owner.project_ref,&owner.user_id,month,kind])?{let entry=decode(row)?;if !needle.is_empty(){if !fold(&format!("{} {}",entry.title,entry.category)).contains(&needle){continue}if skipped<offset{skipped+=1;continue}}items.push(entry);if items.len()==101{break}}
 let has_more=items.len()>100;items.truncate(100);Ok(FinancePage{items,has_more})
}
