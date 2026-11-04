fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["local_storage_status"]),
    )).expect("Tauri permission manifest could not be built");
}
