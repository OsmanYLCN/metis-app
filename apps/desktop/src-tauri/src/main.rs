#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(target_os = "windows"))]
compile_error!("M0.2 desktop storage targets Windows. Other platform adapters are deferred.");

mod storage;
mod session_vault;
use std::path::PathBuf;
use tauri::Manager;
use storage::tasks::{Task, TaskOwner, TaskPage, TaskError};
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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![outbox_count, local_storage_status, session_vault_read, session_vault_write, session_vault_clear, tasks_list, tasks_create, tasks_set_completed, tasks_rename, tasks_delete])
        .run(tauri::generate_context!())
        .expect("Metis could not start");
}

#[tauri::command]
async fn outbox_count(app: tauri::AppHandle, owner: TaskOwner) -> Result<u32, TaskError> {
    let path = storage_directory(&app)?.join("storage").join("personal-os.sqlite3");
    tauri::async_runtime::spawn_blocking(move || storage::outbox::count(&path, &owner))
        .await.map_err(|_| TaskError::from(storage::StorageError::Unavailable))?
}
