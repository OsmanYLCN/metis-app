#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(target_os = "windows"))]
compile_error!("M0.2 desktop storage targets Windows. Other platform adapters are deferred.");

mod storage;
mod session_vault;
use std::path::PathBuf;
use tauri::Manager;
use storage::tasks::{Task, TaskOwner, TaskPage, TaskError, ProjectProgress};
use storage::goals::Goal;
use storage::finance::FinanceEntry;
use storage::calendar::Event;
use storage::workspace::{Entry, EntryPage};
use storage::outbox::{PendingOperation, PendingAction, TaskCloudStatus};
use session_vault::{SessionVault, VaultError, Secret};
use std::{collections::HashMap, sync::{LazyLock, Mutex}};

// Exclusive Windows file handles also prevent two app processes rotating one refresh token.
static VAULTS: LazyLock<Mutex<HashMap<PathBuf, (SessionVault, std::fs::File)>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn with_vault<T>(app: &tauri::AppHandle, project_ref: &str, action: impl FnOnce(&SessionVault) -> Result<T, VaultError>) -> Result<T, VaultError> {
    let root = storage_directory(app).map_err(|_| VaultError::Unavailable)?.join("sessions");
    let vault = SessionVault::new(&root, project_ref)?;
    let key = root.join(project_ref);
    let mut vaults = VAULTS.lock().map_err(|_| VaultError::Unavailable)?;
    if !vaults.contains_key(&key) {
        let lock = vault.lock()?;
        vaults.insert(key.clone(), (vault, lock));
    }
    action(&vaults.get(&key).ok_or(VaultError::Unavailable)?.0)
}

#[tauri::command]
async fn session_vault_read(app: tauri::AppHandle, project_ref: String) -> Result<Option<String>, VaultError> {
    tauri::async_runtime::spawn_blocking(move || with_vault(&app, &project_ref, |vault| {
        vault.load()?.map(|secret| std::str::from_utf8(secret.bytes()).map(str::to_owned).map_err(|_| VaultError::InvalidData)).transpose()
    })).await.map_err(|_| VaultError::Unavailable)?
}
#[tauri::command]
async fn session_vault_write(app: tauri::AppHandle, project_ref: String, token: String) -> Result<(), VaultError> {
    let secret = Secret::from_string(token);
    tauri::async_runtime::spawn_blocking(move || with_vault(&app, &project_ref, |vault| vault.save(secret.bytes())))
        .await.map_err(|_| VaultError::Unavailable)?
}
#[tauri::command]
async fn session_vault_clear(app: tauri::AppHandle, project_ref: String) -> Result<(), VaultError> {
    tauri::async_runtime::spawn_blocking(move || with_vault(&app, &project_ref, SessionVault::clear))
        .await.map_err(|_| VaultError::Unavailable)?
}

fn storage_directory(app: &tauri::AppHandle) -> Result<PathBuf, storage::StorageError> {
    // Process-level override for isolated QA/portable development. Never supplied by the UI.
    if let Some(path) = std::env::var_os("PERSONAL_OS_DATA_DIR") {
        let path = PathBuf::from(path);
        if !path.is_absolute() { return Err(storage::StorageError::Unavailable); }
        return Ok(path);
    }
    app.path().app_local_data_dir().map_err(|_| storage::StorageError::Unavailable)
}

#[tauri::command]
async fn local_storage_status(app: tauri::AppHandle) -> Result<storage::StorageStatus, storage::StorageError> {
    let path = storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    // SQLite handles stay entirely on one blocking worker. No disk IO on the webview thread.
    tauri::async_runtime::spawn_blocking(move || storage::open_storage(&path))
        .await.map_err(|_| storage::StorageError::Unavailable)?
}

#[tauri::command]
async fn tasks_list(app: tauri::AppHandle, owner: TaskOwner, offset: u32) -> Result<TaskPage, TaskError> {
    let path = storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    tauri::async_runtime::spawn_blocking(move || storage::tasks::list(&path, &owner, offset))
        .await.map_err(|_| TaskError::from(storage::StorageError::Unavailable))?
}
#[tauri::command]
async fn tasks_create(app: tauri::AppHandle, owner: TaskOwner, id: String, title: String) -> Result<Task, TaskError> {
    let path = storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    tauri::async_runtime::spawn_blocking(move || storage::tasks::create(&path, &owner, &id, &title))
        .await.map_err(|_| TaskError::from(storage::StorageError::Unavailable))?
}
#[tauri::command]
async fn tasks_set_completed(app: tauri::AppHandle, owner: TaskOwner, id: String, completed: bool) -> Result<Task, TaskError> {
    let path = storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    tauri::async_runtime::spawn_blocking(move || storage::tasks::set_completed(&path, &owner, &id, completed))
        .await.map_err(|_| TaskError::from(storage::StorageError::Unavailable))?
}

#[tauri::command]
async fn tasks_rename(app: tauri::AppHandle, owner: TaskOwner, id: String, title: String, expected_title: String) -> Result<Task, TaskError> {
    let path = storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    tauri::async_runtime::spawn_blocking(move || storage::tasks::rename(&path, &owner, &id, &title, &expected_title))
        .await.map_err(|_| TaskError::from(storage::StorageError::Unavailable))?
}
#[tauri::command]
async fn tasks_delete(app: tauri::AppHandle, owner: TaskOwner, id: String, expected_title: String) -> Result<(), TaskError> {
    let path = storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    tauri::async_runtime::spawn_blocking(move || storage::tasks::delete(&path, &owner, &id, &expected_title))
        .await.map_err(|_| TaskError::from(storage::StorageError::Unavailable))?
}
#[tauri::command]
async fn tasks_set_planning(app: tauri::AppHandle, owner: TaskOwner, id: String, project_id: Option<String>, due_date: Option<String>, priority: u8) -> Result<Task, TaskError> {
    let path = storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    tauri::async_runtime::spawn_blocking(move || storage::tasks::set_planning(&path,&owner,&id,project_id.as_deref(),due_date.as_deref(),priority))
        .await.map_err(|_| TaskError::from(storage::StorageError::Unavailable))?
}
#[tauri::command]
async fn tasks_scheduled(app: tauri::AppHandle, owner: TaskOwner, from: String, to: String) -> Result<Vec<Task>, TaskError> {
    let path = storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    tauri::async_runtime::spawn_blocking(move || storage::tasks::scheduled(&path,&owner,&from,&to))
        .await.map_err(|_| TaskError::from(storage::StorageError::Unavailable))?
}
#[tauri::command]
async fn project_progress(app:tauri::AppHandle,owner:TaskOwner,today:String)->Result<Vec<ProjectProgress>,TaskError>{let path=storage_directory(&app)?.join("storage").join("personal-os.sqlite3");tauri::async_runtime::spawn_blocking(move||storage::tasks::project_progress(&path,&owner,&today)).await.map_err(|_|TaskError::from(storage::StorageError::Unavailable))?}
#[tauri::command]
async fn goals_list(app:tauri::AppHandle,owner:TaskOwner)->Result<Vec<Goal>,TaskError>{let path=storage_directory(&app)?.join("storage").join("personal-os.sqlite3");tauri::async_runtime::spawn_blocking(move||storage::goals::list(&path,&owner)).await.map_err(|_|TaskError::from(storage::StorageError::Unavailable))?}
#[tauri::command]
async fn goals_create(app:tauri::AppHandle,owner:TaskOwner,id:String,title:String,description:String,state:String,target_date:Option<String>,progress:u8)->Result<Goal,TaskError>{let path=storage_directory(&app)?.join("storage").join("personal-os.sqlite3");tauri::async_runtime::spawn_blocking(move||storage::goals::create(&path,&owner,&id,&title,&description,&state,target_date.as_deref(),progress)).await.map_err(|_|TaskError::from(storage::StorageError::Unavailable))?}
#[tauri::command]
async fn goals_save(app:tauri::AppHandle,owner:TaskOwner,id:String,expected_revision:i64,title:String,description:String,state:String,target_date:Option<String>,progress:u8)->Result<Goal,TaskError>{let path=storage_directory(&app)?.join("storage").join("personal-os.sqlite3");tauri::async_runtime::spawn_blocking(move||storage::goals::save(&path,&owner,&id,expected_revision,&title,&description,&state,target_date.as_deref(),progress)).await.map_err(|_|TaskError::from(storage::StorageError::Unavailable))?}
#[tauri::command]
async fn goals_delete(app:tauri::AppHandle,owner:TaskOwner,id:String,expected_revision:i64)->Result<(),TaskError>{let path=storage_directory(&app)?.join("storage").join("personal-os.sqlite3");tauri::async_runtime::spawn_blocking(move||storage::goals::delete(&path,&owner,&id,expected_revision)).await.map_err(|_|TaskError::from(storage::StorageError::Unavailable))?}
#[tauri::command]
async fn finance_list(app:tauri::AppHandle,owner:TaskOwner,month:String)->Result<Vec<FinanceEntry>,TaskError>{let path=storage_directory(&app)?.join("storage").join("personal-os.sqlite3");tauri::async_runtime::spawn_blocking(move||storage::finance::list(&path,&owner,&month)).await.map_err(|_|TaskError::from(storage::StorageError::Unavailable))?}
#[tauri::command]
async fn finance_create(app:tauri::AppHandle,owner:TaskOwner,id:String,kind:String,title:String,category:String,amount_cents:i64,entry_date:String)->Result<FinanceEntry,TaskError>{let path=storage_directory(&app)?.join("storage").join("personal-os.sqlite3");tauri::async_runtime::spawn_blocking(move||storage::finance::create(&path,&owner,&id,&kind,&title,&category,amount_cents,&entry_date)).await.map_err(|_|TaskError::from(storage::StorageError::Unavailable))?}
#[tauri::command]
async fn finance_delete(app:tauri::AppHandle,owner:TaskOwner,id:String)->Result<(),TaskError>{let path=storage_directory(&app)?.join("storage").join("personal-os.sqlite3");tauri::async_runtime::spawn_blocking(move||storage::finance::delete(&path,&owner,&id)).await.map_err(|_|TaskError::from(storage::StorageError::Unavailable))?}
#[tauri::command]
async fn events_list(app:tauri::AppHandle,owner:TaskOwner,from:String,to:String)->Result<Vec<Event>,TaskError>{let path=storage_directory(&app)?.join("storage").join("personal-os.sqlite3");tauri::async_runtime::spawn_blocking(move||storage::calendar::list(&path,&owner,&from,&to)).await.map_err(|_|TaskError::from(storage::StorageError::Unavailable))?}
#[tauri::command]
async fn events_create(app:tauri::AppHandle,owner:TaskOwner,id:String,title:String,details:String,event_date:String,start_time:Option<String>,end_time:Option<String>)->Result<Event,TaskError>{let path=storage_directory(&app)?.join("storage").join("personal-os.sqlite3");tauri::async_runtime::spawn_blocking(move||storage::calendar::create(&path,&owner,&id,&title,&details,&event_date,start_time.as_deref(),end_time.as_deref())).await.map_err(|_|TaskError::from(storage::StorageError::Unavailable))?}
#[tauri::command]
async fn events_save(app:tauri::AppHandle,owner:TaskOwner,id:String,expected_revision:i64,title:String,details:String,event_date:String,start_time:Option<String>,end_time:Option<String>)->Result<Event,TaskError>{let path=storage_directory(&app)?.join("storage").join("personal-os.sqlite3");tauri::async_runtime::spawn_blocking(move||storage::calendar::save(&path,&owner,&id,expected_revision,&title,&details,&event_date,start_time.as_deref(),end_time.as_deref())).await.map_err(|_|TaskError::from(storage::StorageError::Unavailable))?}
#[tauri::command]
async fn events_delete(app:tauri::AppHandle,owner:TaskOwner,id:String,expected_revision:i64)->Result<(),TaskError>{let path=storage_directory(&app)?.join("storage").join("personal-os.sqlite3");tauri::async_runtime::spawn_blocking(move||storage::calendar::delete(&path,&owner,&id,expected_revision)).await.map_err(|_|TaskError::from(storage::StorageError::Unavailable))?}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![workspace_list, workspace_create, workspace_save, workspace_delete, outbox_count, outbox_statuses, outbox_pending, outbox_pending_for_task, outbox_begin, outbox_acknowledge, task_actions_pending, task_action_prepare, task_action_begin, task_action_acknowledge, local_storage_status, session_vault_read, session_vault_write, session_vault_clear, tasks_list, tasks_create, tasks_set_completed, tasks_rename, tasks_delete, tasks_set_planning, tasks_scheduled, project_progress, goals_list, goals_create, goals_save, goals_delete, finance_list, finance_create, finance_delete, events_list, events_create, events_save, events_delete])
        .run(tauri::generate_context!())
        .expect("Metis could not start");
}

#[tauri::command]
async fn workspace_list(app: tauri::AppHandle, owner: TaskOwner, kind: String, query: String, offset: u32) -> Result<EntryPage, TaskError> {
    let path=storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    tauri::async_runtime::spawn_blocking(move || storage::workspace::list(&path,&owner,&kind,&query,offset))
        .await.map_err(|_| TaskError::from(storage::StorageError::Unavailable))?
}
#[tauri::command]
async fn workspace_create(app: tauri::AppHandle, owner: TaskOwner, id: String, kind: String, title: String, body: String, state: String, pinned: bool) -> Result<Entry, TaskError> {
    let path=storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    tauri::async_runtime::spawn_blocking(move || storage::workspace::create(&path,&owner,&id,&kind,&title,&body,&state,pinned))
        .await.map_err(|_| TaskError::from(storage::StorageError::Unavailable))?
}
#[tauri::command]
async fn workspace_save(app: tauri::AppHandle, owner: TaskOwner, id: String, kind: String, expected_revision: i64, title: String, body: String, state: String, pinned: bool) -> Result<Entry, TaskError> {
    let path=storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    tauri::async_runtime::spawn_blocking(move || storage::workspace::save(&path,&owner,&id,&kind,expected_revision,&title,&body,&state,pinned))
        .await.map_err(|_| TaskError::from(storage::StorageError::Unavailable))?
}
#[tauri::command]
async fn workspace_delete(app: tauri::AppHandle, owner: TaskOwner, id: String, kind: String, expected_revision: i64) -> Result<(), TaskError> {
    let path=storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    tauri::async_runtime::spawn_blocking(move || storage::workspace::delete(&path,&owner,&id,&kind,expected_revision))
        .await.map_err(|_| TaskError::from(storage::StorageError::Unavailable))?
}

#[tauri::command]
async fn outbox_count(app: tauri::AppHandle, owner: TaskOwner) -> Result<u32, TaskError> {
    let path = storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    tauri::async_runtime::spawn_blocking(move || storage::outbox::count(&path, &owner))
        .await.map_err(|_| TaskError::from(storage::StorageError::Unavailable))?
}

#[tauri::command]
async fn outbox_statuses(app: tauri::AppHandle, owner: TaskOwner, task_ids: Vec<String>) -> Result<Vec<TaskCloudStatus>, TaskError> {
    let path = storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    tauri::async_runtime::spawn_blocking(move || storage::outbox::statuses(&path, &owner, &task_ids))
        .await.map_err(|_| TaskError::from(storage::StorageError::Unavailable))?
}

#[tauri::command]
async fn outbox_pending(app: tauri::AppHandle, owner: TaskOwner, after: i64) -> Result<Vec<PendingOperation>, TaskError> {
    let path = storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    tauri::async_runtime::spawn_blocking(move || storage::outbox::pending(&path, &owner, after))
        .await.map_err(|_| TaskError::from(storage::StorageError::Unavailable))?
}

#[tauri::command]
async fn task_actions_pending(app: tauri::AppHandle, owner: TaskOwner) -> Result<Vec<PendingAction>, TaskError> {
    let path = storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    tauri::async_runtime::spawn_blocking(move || storage::outbox::pending_actions(&path, &owner))
        .await.map_err(|_| TaskError::from(storage::StorageError::Unavailable))?
}

#[tauri::command]
async fn task_action_prepare(app: tauri::AppHandle, owner: TaskOwner, task_id: String, kind: String, completed: Option<bool>) -> Result<PendingAction, TaskError> {
    let path = storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    tauri::async_runtime::spawn_blocking(move || storage::outbox::prepare_action(&path,&owner,&task_id,&kind,completed))
        .await.map_err(|_| TaskError::from(storage::StorageError::Unavailable))?
}

#[tauri::command]
async fn task_action_begin(app: tauri::AppHandle, owner: TaskOwner, operation_id: String) -> Result<PendingAction, TaskError> {
    let path = storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    tauri::async_runtime::spawn_blocking(move || storage::outbox::begin_action(&path,&owner,&operation_id))
        .await.map_err(|_| TaskError::from(storage::StorageError::Unavailable))?
}

#[tauri::command]
async fn task_action_acknowledge(app: tauri::AppHandle, owner: TaskOwner, operation_id: String, task_id: String, revision: i64) -> Result<(), TaskError> {
    let path = storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    tauri::async_runtime::spawn_blocking(move || storage::outbox::acknowledge_action(&path,&owner,&operation_id,&task_id,revision))
        .await.map_err(|_| TaskError::from(storage::StorageError::Unavailable))?
}

#[tauri::command]
async fn outbox_pending_for_task(app: tauri::AppHandle, owner: TaskOwner, task_id: String) -> Result<Option<PendingOperation>, TaskError> {
    let path = storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    tauri::async_runtime::spawn_blocking(move || storage::outbox::pending_for_task(&path, &owner, &task_id)).await.map_err(|_| TaskError::from(storage::StorageError::Unavailable))?
}

#[tauri::command]
async fn outbox_begin(app: tauri::AppHandle, owner: TaskOwner, sequence: i64) -> Result<PendingOperation, TaskError> {
    let path = storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    tauri::async_runtime::spawn_blocking(move || storage::outbox::begin_delivery(&path, &owner, sequence)).await.map_err(|_| TaskError::from(storage::StorageError::Unavailable))?
}

#[tauri::command]
async fn outbox_acknowledge(app: tauri::AppHandle, owner: TaskOwner, operation_id: String, task_id: String, revision: i64, outcome: String) -> Result<(), TaskError> {
    let path = storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    tauri::async_runtime::spawn_blocking(move || storage::outbox::acknowledge(&path, &owner, &operation_id, &task_id, revision, &outcome)).await.map_err(|_| TaskError::from(storage::StorageError::Unavailable))?
}
