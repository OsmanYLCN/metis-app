#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(target_os = "windows"))]
compile_error!("M0.2 desktop storage targets Windows. Other platform adapters are deferred.");

mod storage;
use std::path::PathBuf;
use tauri::Manager;

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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![local_storage_status])
        .run(tauri::generate_context!())
        .expect("Metis could not start");
}
