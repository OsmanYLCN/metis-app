fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["outbox_count", "local_storage_status", "session_vault_read", "session_vault_write", "session_vault_clear", "tasks_list", "tasks_create", "tasks_set_completed", "tasks_rename", "tasks_delete"]),
    )).expect("Tauri permission manifest could not be built");
}
