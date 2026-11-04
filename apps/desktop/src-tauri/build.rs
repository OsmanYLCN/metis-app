fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["local_storage_status", "session_vault_read", "session_vault_write", "session_vault_clear"]),
    )).expect("Tauri permission manifest could not be built");
}
