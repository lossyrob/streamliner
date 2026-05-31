pub mod commands;
pub mod config;
pub mod sse_client;
pub mod tray;

use config::DesktopConfig;

pub struct AppState {
    pub config: DesktopConfig,
    pub http: reqwest::Client,
}

pub fn run() {
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .expect("failed to build HTTP client");
    let config = tauri::async_runtime::block_on(config::resolve_config(&http));

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            tray::show_feed(app);
        }))
        .manage(AppState {
            config: config.clone(),
            http: http.clone(),
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_config,
            commands::list_notifications,
            commands::open_link,
            commands::notification_badge,
        ])
        .setup(move |app| {
            tray::setup_tray(app.handle())?;
            sse_client::spawn(app.handle().clone(), config.clone(), http.clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Streamliner desktop");
}
