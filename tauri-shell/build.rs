fn main() {
    let attributes =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "open_chat",
            "manager_call",
            "list_models",
            "list_model_details",
            "rescan_model_folders",
            "read_engine_config",
            "save_engine_config",
            "open_trt_guide",
            "window_action",
            "get_app_paths",
            "save_app_paths",
            "pick_folders",
            "pick_folder",
            "list_log_files",
            "read_log_file",
            "open_logs_folder",
        ]));
    tauri_build::try_build(attributes).expect("failed to configure Tauri permissions");
}
