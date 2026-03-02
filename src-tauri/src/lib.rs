mod project_browser;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            project_browser::list_projects,
            project_browser::list_project_entries,
            project_browser::read_memory,
            project_browser::read_session_timeline
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
