fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "local_storage_status", "session_vault_read", "session_vault_write", "session_vault_clear",
            "tasks_list", "tasks_create", "tasks_set_completed", "tasks_rename", "tasks_delete",
            "outbox_count", "outbox_statuses", "outbox_pending", "outbox_pending_for_task", "outbox_begin", "outbox_acknowledge",
            "task_actions_pending", "task_action_prepare", "task_action_begin", "task_action_acknowledge",
            "workspace_list", "workspace_create", "workspace_save", "workspace_delete",
        ]),
    )).expect("Tauri permission manifest could not be built");
}
