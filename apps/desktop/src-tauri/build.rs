fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "outbound_list", "outbound_prepare", "outbound_ack", "inbox_apply", "inbox_status", "inbox_stage", "inbox_compare", "local_storage_status", "session_vault_read", "session_vault_write", "session_vault_clear",
            "tasks_list", "tasks_create", "tasks_set_completed", "tasks_rename", "tasks_delete", "tasks_set_planning", "tasks_scheduled",
            "outbox_count", "outbox_statuses", "outbox_pending", "outbox_pending_for_task", "outbox_begin", "outbox_acknowledge",
            "task_actions_pending", "task_action_prepare", "task_action_begin", "task_action_acknowledge",
            "workspace_search", "workspace_get", "workspace_list", "workspace_create", "workspace_save", "workspace_delete",
            "project_progress", "goals_get", "events_get", "delivery_status", "backup_create", "backup_list", "backup_preview", "backup_restore", "notifications_page", "finance_get", "finance_save", "finance_categories", "events_overlaps", "tasks_get", "workspace_summary", "goals_summary", "goals_page", "goals_list", "goals_create", "goals_save", "goals_delete",
            "finance_page", "finance_list", "finance_totals", "finance_create", "finance_delete",
            "events_list", "events_create", "events_save", "events_delete",
            "notifications_list", "notifications_set",
            "budgets_list", "budgets_set",
        ]),
    )).expect("Tauri permission manifest could not be built");
}
