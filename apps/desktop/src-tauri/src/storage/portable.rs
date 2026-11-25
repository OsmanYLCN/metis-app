//! Device-wide portable recovery. Only allowlisted logical rows, never archive SQL/paths.
//! Both journals are captured under cache -> main locks. A restore builds a new generation;
//! the active pointer changes only on next process startup, under an exclusive device lock.
use super::{backup, connect, inbox, sqlite::Transaction, tasks::{TaskError, TaskOwner}, StorageError};
use aes_gcm::{aead::{Aead, KeyInit, OsRng, rand_core::RngCore, Payload}, Aes256Gcm, Nonce};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs::{self, File, OpenOptions}, io::{Read, Write}, path::{Path, PathBuf}};
use zeroize::Zeroizing;

const MAGIC: &[u8; 8] = b"METISPB1";
const LIMIT: usize = 64 * 1024 * 1024;
const ITERATIONS: u32 = 600_000;
// Column lists are part of format 1. No nullable columns in these five cache tables.
const CACHE: &[(&str, &str)] = &[
    ("inbox_state", "project,user_id,cursor"),
    ("inbox_records", "project,user_id,entity,id,revision,deleted,snapshot"),
    ("outbound", "project,user_id,entity,id,operation,expected,payload,action,state"),
    ("sync_control", "project,user_id,enabled,caught_up,recovering,receiving,merge_backup"),
    ("sync_conflicts", "project,user_id,entity,id,reason"),
];
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Bundle {
    format: u32,
    accounts: Vec<backup::Snapshot>,
    cache: Vec<Vec<Vec<String>>>,
    guards: Vec<Vec<String>>,
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Preview { pub ticket: String, pub accounts: usize, pub records: usize, pub pending: usize }
fn bad() -> TaskError { TaskError::InvalidInput }
fn io(_: std::io::Error) -> TaskError { StorageError::Unavailable.into() }
pub fn device_lock(root:&Path)->std::io::Result<File>{
    use std::os::windows::fs::OpenOptionsExt;
    // Tauri starts the replacement process immediately before exiting the old one.
    // Wait briefly for that handle to close; never allow two writers during activation.
    for attempt in 0..30 {
        match OpenOptions::new().read(true).write(true).create(true).truncate(false).share_mode(0).open(root.join("device.lock")) {
            Ok(file)=>return Ok(file),
            Err(error) if matches!(error.raw_os_error(),Some(32|33)) && attempt<29=>std::thread::sleep(std::time::Duration::from_millis(100)),
            Err(error)=>return Err(error),
        }
    }
    unreachable!()
}
fn hex_id() -> String { let mut b=[0u8;16]; OsRng.fill_bytes(&mut b); b.iter().map(|v|format!("{v:02x}")).collect() }
fn valid_id(s:&str)->bool { s.len()==32 && s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)) }
fn read_bounded(path:&Path)->Result<Vec<u8>,TaskError>{
    let f=File::open(path).map_err(io)?; if f.metadata().map_err(io)?.len()>LIMIT as u64 {return Err(bad())}
    let mut bytes=Vec::new(); f.take((LIMIT+1)as u64).read_to_end(&mut bytes).map_err(io)?;
    if bytes.len()>LIMIT {return Err(bad())} Ok(bytes)
}
fn write_new(path:&Path,bytes:&[u8])->Result<(),TaskError>{
    let mut f=OpenOptions::new().write(true).create_new(true).open(path).map_err(io)?;
    f.write_all(bytes).map_err(io)?; f.sync_all().map_err(io)
}
fn capture(path:&Path)->Result<Bundle,TaskError>{
    let cache=inbox::open(path)?; let ct=Transaction::begin(&cache)?;
    let(db,_)=connect(path)?; let tx=Transaction::begin(&db)?;
    let mut accounts=Vec::new();
    for r in backup::owners(&db)? {
        let owner=TaskOwner{project_ref:r[0].clone(),user_id:r[1].clone()}; owner.validate()?;
        accounts.push(backup::collect(&db,&owner)?);
    }
    let mut rows=Vec::new();
    for (table,columns) in CACHE {
        let r=cache.query(&format!("SELECT {columns} FROM {table} ORDER BY {columns} LIMIT 200001"),&[])?;
        if r.len()>200000 {return Err(bad())} rows.push(r);
    }
    let guards=db.query("SELECT project_ref,user_id,restored_at,backup_id FROM recovery_guard ORDER BY project_ref,user_id",&[])?;
    tx.commit()?; ct.commit()?; Ok(Bundle{format:1,accounts,cache:rows,guards})
}
fn seal(plain:&[u8],password:&[u8])->Result<Vec<u8>,TaskError>{
    if password.len()<12 || password.len()>1024 || plain.len()>LIMIT-64 {return Err(bad())}
    let mut header=MAGIC.to_vec(); let mut random=[0u8;28]; OsRng.fill_bytes(&mut random); header.extend(random);
    let mut key=Zeroizing::new([0u8;32]); pbkdf2::pbkdf2_hmac::<Sha256>(password,&header[8..24],ITERATIONS,&mut *key);
    let cipher=Aes256Gcm::new_from_slice(&*key).map_err(|_|bad())?;
    let encrypted=cipher.encrypt(Nonce::from_slice(&header[24..36]),Payload{msg:plain,aad:&header}).map_err(|_|bad())?;
    header.extend(encrypted); Ok(header)
}
fn unseal(bytes:&[u8],password:&[u8])->Result<Zeroizing<Vec<u8>>,TaskError>{
    if bytes.len()<52 || bytes.len()>LIMIT || &bytes[..8]!=MAGIC || password.len()<12 || password.len()>1024 {return Err(bad())}
    let mut key=Zeroizing::new([0u8;32]); pbkdf2::pbkdf2_hmac::<Sha256>(password,&bytes[8..24],ITERATIONS,&mut *key);
    let cipher=Aes256Gcm::new_from_slice(&*key).map_err(|_|bad())?;
    Ok(Zeroizing::new(cipher.decrypt(Nonce::from_slice(&bytes[24..36]),Payload{msg:&bytes[36..],aad:&bytes[..36]}).map_err(|_|bad())?))
}
pub fn export_dialog(path:&Path,password:String)->Result<Option<String>,TaskError>{
    let password=Zeroizing::new(password);
    if password.len()<12 || password.len()>1024 {return Err(bad())}
    let Some(target)=rfd::FileDialog::new().set_title("Şifreli taşınabilir Metis yedeği").add_filter("Metis yedeği",&["metisportable"]).set_file_name("Metis.metisportable").save_file() else{return Ok(None)};
    // Never truncate an existing file, even after the OS overwrite dialog.
    if target.exists(){return Err(TaskError::Conflict)}
    let plain=Zeroizing::new(serde_json::to_vec(&capture(path)?).map_err(|_|bad())?);
    let encrypted=seal(&plain,password.as_bytes())?;
    write_new(&target,&encrypted)?; Ok(Some(target.to_string_lossy().into_owned()))
}
fn install(root:&Path,bundle:Bundle)->Result<Preview,TaskError>{
    if bundle.format!=1 || bundle.accounts.len()>1000 || bundle.cache.len()!=CACHE.len() || bundle.guards.len()>1000 {return Err(bad())}
    let ticket=hex_id(); let dir=root.join("restored").join(&ticket); fs::create_dir_all(&dir).map_err(io)?;
    let path=dir.join("personal-os.sqlite3"); let(db,_)=connect(&path)?; let tx=Transaction::begin(&db)?;
    let mut seen=std::collections::HashSet::new(); let mut records=0;
    for snapshot in &bundle.accounts {
        let owner=TaskOwner{project_ref:snapshot.project.clone(),user_id:snapshot.user.clone()}; owner.validate()?;
        if !seen.insert((owner.project_ref.clone(),owner.user_id.clone())) {return Err(bad())}
        backup::install(&db,&owner,snapshot)?;
        records+=snapshot.tables.iter().map(Vec::len).sum::<usize>();
    }
    for r in &bundle.guards {
        if r.len()!=4 {return Err(bad())}
        db.query("INSERT INTO recovery_guard VALUES(?1,?2,?3,?4)",&r.iter().map(String::as_str).collect::<Vec<_>>())?;
    }
    tx.commit()?; drop(db);
    let cache=inbox::open(&path)?; let ct=Transaction::begin(&cache)?;
    for ((table,columns),rows) in CACHE.iter().zip(&bundle.cache) {
        if rows.len()>200000 {return Err(bad())} let count=columns.split(',').count();
        let args=(1..=count).map(|n|format!("?{n}")).collect::<Vec<_>>().join(",");
        for r in rows {
            if r.len()!=count {return Err(bad())}
            TaskOwner{project_ref:r[0].clone(),user_id:r[1].clone()}.validate()?;
            cache.query(&format!("INSERT INTO {table}({columns}) VALUES({args})"),&r.iter().map(String::as_str).collect::<Vec<_>>())?;
        }
    }
    // Never inherit the other device's automatic network consent or freshness timestamp.
    cache.execute("UPDATE sync_control SET enabled=0,receiving=0,caught_up=0,merge_backup=''")?;
    ct.commit()?; drop(cache);
    verify(&path)?;
    let pending=bundle.cache[2].len()+bundle.accounts.iter().map(|s|s.tables[8].iter().filter(|r|r[6]=="pending").count()+s.tables[9].iter().filter(|r|r[5]=="pending").count()).sum::<usize>();
    let signature=signature(&path)?;
    write_new(&dir.join("ready"),signature.as_bytes())?;
    Ok(Preview{ticket,accounts:bundle.accounts.len(),records,pending})
}
fn signature(path:&Path)->Result<String,TaskError>{
    // All validation connections must be closed (including WAL checkpoint) before hashing.
    let mut digest=Sha256::new();
    for name in ["personal-os.sqlite3","cloud-inbox.sqlite3"] {digest.update(read_bounded(&path.parent().ok_or_else(bad)?.join(name))?);}
    Ok(format!("{:x}",digest.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{tasks, outbox, workspace, outbound};
    fn root()->PathBuf {let p=std::env::temp_dir().join(format!("metis-portable-{}",hex_id()));fs::create_dir(&p).unwrap();p}
    fn owner()->TaskOwner {TaskOwner{project_ref:"test-project".into(),user_id:"11111111-1111-4111-8111-111111111111".into()}}

    #[test]
    fn portable_restart_waits_for_previous_process_lock(){
        let dir=root();let held=device_lock(&dir).unwrap();
        let release=std::thread::spawn(move||{std::thread::sleep(std::time::Duration::from_millis(150));drop(held);});
        let next=device_lock(&dir).unwrap();release.join().unwrap();drop(next);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn portable_encryption_authenticates_password_header_and_body(){
        let password=b"synthetic-test-passphrase";
        let encrypted=seal(b"synthetic data",password).unwrap();
        assert_eq!(&*unseal(&encrypted,password).unwrap(),b"synthetic data");
        assert!(unseal(&encrypted,b"wrong-test-passphrase").is_err());
        let mut tampered=encrypted.clone();tampered[25]^=1;
        assert!(unseal(&tampered,password).is_err());
        let mut tampered=encrypted;*tampered.last_mut().unwrap()^=1;
        assert!(unseal(&tampered,password).is_err());
        assert!(unseal(b"truncated",password).is_err());
        assert!(seal(b"data",b"short").is_err());
    }

    #[test]
    fn portable_restores_both_journals_and_switches_only_after_confirmation(){
        let source=root();let path=source.join("storage/personal-os.sqlite3");let o=owner();
        let id="a".repeat(32);let note="b".repeat(32);
        let other=TaskOwner{project_ref:o.project_ref.clone(),user_id:"22222222-2222-4222-8222-222222222222".into()};
        tasks::create(&path,&other,&"c".repeat(32),"Other account").unwrap();
        tasks::create(&path,&o,&id,"Uncertain task").unwrap();
        let pending=outbox::pending(&path,&o,0).unwrap();
        outbox::begin_delivery(&path,&o,pending[0].sequence).unwrap();
        workspace::create(&path,&o,&note,"note","Uncertain note","Body","active",false).unwrap();
        let candidate=outbound::list(&path,&o,0).unwrap().into_iter().find(|r|r.entity=="note").unwrap();
        let frozen=outbound::prepare(&path,&o,"note",&note,&candidate.digest,"","").unwrap();
        let encoded=serde_json::to_vec(&capture(&path).unwrap()).unwrap();
        let target=root();let old=target.join("storage/personal-os.sqlite3");
        fs::create_dir_all(old.parent().unwrap()).unwrap();fs::write(&old,b"broken original sqlite").unwrap();
        let preview=install(&target,serde_json::from_slice(&encoded).unwrap()).unwrap();
        assert_eq!(preview.accounts,2);
        assert_eq!(startup(&target).unwrap(),old); // Inspection cannot activate.
        schedule(&target,&preview.ticket).unwrap();
        let recovered=startup(&target).unwrap();
        assert_ne!(recovered,old);assert_eq!(fs::read(&old).unwrap(),b"broken original sqlite");
        assert_eq!(tasks::list(&recovered,&o,0).unwrap().items[0].title,"Uncertain task");
        assert_eq!(tasks::list(&recovered,&o,0).unwrap().items.len(),1);
        assert_eq!(tasks::list(&recovered,&other,0).unwrap().items[0].title,"Other account");
        let after=outbox::pending(&recovered,&o,0).unwrap();assert_eq!(after[0].operation_id,pending[0].operation_id);
        assert_eq!(backup::delivery_status(&recovered,&o).unwrap().uncertain,1);
        let again=outbound::prepare(&recovered,&o,"note",&note,&candidate.digest,"","").unwrap();
        assert_eq!(again.operation_id,frozen.operation_id);assert_eq!(again.payload,frozen.payload);
        assert!(!super::super::sync::status(&recovered,&o).unwrap().enabled);
        assert!(!super::super::sync::status(&recovered,&o).unwrap().receiving);
        assert_eq!(startup(&target).unwrap(),recovered); // Restart keeps the selected generation.
        assert!(schedule(&target,"../../outside").is_err());
        fs::remove_dir_all(source).unwrap();fs::remove_dir_all(target).unwrap();
    }

    #[test]
    fn portable_rejects_stale_staging_without_replacing_active_data(){
        let source=root();let path=source.join("storage/personal-os.sqlite3");let o=owner();
        tasks::create(&path,&o,&"a".repeat(32),"Original").unwrap();
        let preview=install(&source,capture(&path).unwrap()).unwrap();
        let staged=source.join("restored").join(&preview.ticket).join("personal-os.sqlite3");
        tasks::create(&staged,&o,&"b".repeat(32),"Changed after inspection").unwrap();
        assert_eq!(schedule(&source,&preview.ticket),Err(TaskError::Conflict));
        assert_eq!(startup(&source).unwrap(),path);
        fs::remove_dir_all(source).unwrap();
    }
}
fn verify(path:&Path)->Result<(),TaskError>{
    let(db,_)=connect(path)?;
    if db.scalar("PRAGMA integrity_check")?!="ok" || !db.query("PRAGMA foreign_key_check",&[])?.is_empty(){return Err(bad())}
    let cache=inbox::open(path)?;
    if cache.scalar("PRAGMA integrity_check")?!="ok" {return Err(bad())} Ok(())
}
pub fn inspect_dialog(root:&Path,password:String)->Result<Option<Preview>,TaskError>{
    let password=Zeroizing::new(password);
    let Some(source)=rfd::FileDialog::new().set_title("Metis yedeğini seç").add_filter("Metis yedeği",&["metisportable"]).pick_file() else{return Ok(None)};
    let plain=unseal(&read_bounded(&source)?,password.as_bytes())?;
    let bundle:Bundle=serde_json::from_slice(&plain).map_err(|_|bad())?;
    Ok(Some(install(root,bundle)?))
}
pub fn schedule(root:&Path,ticket:&str)->Result<(),TaskError>{
    if !valid_id(ticket){return Err(bad())}
    let dir=root.join("restored").join(ticket); let path=dir.join("personal-os.sqlite3");
    verify(&path)?;
    if read_bounded(&dir.join("ready"))? != signature(&path)?.as_bytes(){return Err(TaskError::Conflict)}
    let temp=root.join(format!("pending-{}.tmp",hex_id())); write_new(&temp,ticket.as_bytes())?;
    replace(&temp,&root.join("pending-restore"))?; Ok(())
}
// Caller holds a device-wide exclusive file handle for the entire process lifetime.
pub fn startup(root:&Path)->Result<PathBuf,TaskError>{
    let pending=root.join("pending-restore");
    if pending.exists(){
        let ticket=String::from_utf8(read_bounded(&pending)?).map_err(|_|bad())?;
        if !valid_id(&ticket){return Err(bad())}
        let dir=root.join("restored").join(&ticket); let path=dir.join("personal-os.sqlite3");
        verify(&path)?;
        if read_bounded(&dir.join("ready"))?!=signature(&path)?.as_bytes(){return Err(TaskError::Conflict)}
        replace(&pending,&root.join("active-storage"))?;
    }
    let active=root.join("active-storage");
    let directory=if active.exists(){
        let ticket=String::from_utf8(read_bounded(&active)?).map_err(|_|bad())?;
        if !valid_id(&ticket){return Err(bad())} root.join("restored").join(ticket)
    }else{root.join("storage")};
    Ok(directory.join("personal-os.sqlite3"))
}
fn replace(source:&Path,target:&Path)->Result<(),TaskError>{
    use std::os::windows::ffi::OsStrExt;
    #[link(name="kernel32")] extern "system" {fn MoveFileExW(a:*const u16,b:*const u16,flags:u32)->i32;}
    let a:Vec<u16>=source.as_os_str().encode_wide().chain(Some(0)).collect();
    let b:Vec<u16>=target.as_os_str().encode_wide().chain(Some(0)).collect();
    // Same-volume atomic pointer replacement with write-through; source databases stay untouched.
    if unsafe{MoveFileExW(a.as_ptr(),b.as_ptr(),1|8)}==0{return Err(StorageError::Unavailable.into())} Ok(())
}
