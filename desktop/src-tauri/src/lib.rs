pub mod activation;
pub mod commands;
pub mod config;
pub mod sse_client;
pub mod toast;
pub mod tray;

use std::path::PathBuf;

use config::DesktopConfig;
use tauri::Manager;

pub struct AppState {
    pub config: DesktopConfig,
    pub http: reqwest::Client,
}

pub fn run() {
    // Associate the process with the AUMID before any toast is shown.
    activation::set_process_aumid();

    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .expect("failed to build HTTP client");
    // The SSE stream is long-lived: a total request `timeout` would kill the
    // connection mid-stream (the server's heartbeat is 15s), causing endless
    // reconnect churn. Use connect + per-read timeouts instead, with the read
    // timeout comfortably above the heartbeat interval so a genuinely dead peer
    // is still detected.
    let sse_http = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .read_timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("failed to build SSE HTTP client");
    let config = tauri::async_runtime::block_on(config::resolve_config(&http));

    // Cold start: the OS launches this (first) instance with the protocol URL in
    // our own argv; the single-instance callback only fires for *secondary*
    // launches, so capture the cold-start URL here and route it after setup.
    let cold_start_activation = activation::activation_arg(std::env::args());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init({
            let config = config.clone();
            let http = http.clone();
            move |app, argv, _cwd| {
                // Warm start: a second launch was forwarded here. If it carries a
                // protocol URL, route it; otherwise just surface the feed.
                match activation::activation_arg(argv) {
                    Some(url) => {
                        if let Some(id) = activation::parse_notification_id(&url) {
                            tauri::async_runtime::spawn(activation::activate(
                                config.api_base_url.clone(),
                                http.clone(),
                                id,
                            ));
                        }
                    }
                    None => tray::show_feed(app),
                }
            }
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
            let badge_cache_dir = badge_cache_dir(app);

            // Register the AUMID + protocol scheme (idempotent) BEFORE the SSE
            // loop can fire the first toast.
            #[cfg(target_os = "windows")]
            {
                let icon_path = write_app_icon(&badge_cache_dir);
                if let Ok(exe) = std::env::current_exe() {
                    if let Err(err) = activation::register(&exe, &icon_path) {
                        eprintln!("activation: registration failed: {err}");
                    }
                }
            }

            tray::setup_tray(app.handle())?;
            sse_client::spawn(
                app.handle().clone(),
                config.clone(),
                sse_http,
                badge_cache_dir,
            );

            if let Some(url) = cold_start_activation.clone() {
                if let Some(id) = activation::parse_notification_id(&url) {
                    tauri::async_runtime::spawn(activation::activate(
                        config.api_base_url.clone(),
                        http.clone(),
                        id,
                    ));
                }
            }

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

/// Per-user badge cache directory (`<app-data>/badges`), with a temp-dir
/// fallback if the app data dir can't be resolved.
fn badge_cache_dir(app: &tauri::App) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("streamliner-desktop"))
        .join("badges")
}

/// Render a default Streamliner badge to use as the AUMID toast icon and return
/// its path. Windows-only (the icon is referenced from the HKCU AUMID entry).
#[cfg(target_os = "windows")]
fn write_app_icon(badge_cache_dir: &std::path::Path) -> PathBuf {
    use streamliner_core::badge::render_badge;
    use streamliner_core::model::EventKind;

    let dir = badge_cache_dir
        .parent()
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(|| badge_cache_dir.to_path_buf());
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("app-icon.png");
    let png = render_badge("6D5DFB", "SL", EventKind::Generic, 96);
    let _ = std::fs::write(&path, png);
    path
}
