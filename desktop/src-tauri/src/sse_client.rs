use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use streamliner_core::{
    dedupe::ToastDedupe,
    model::Notification,
    sse::{SseParser, EVENT_HEARTBEAT, EVENT_NOTIFICATION_CREATED, EVENT_SNAPSHOT},
};
use tauri::{AppHandle, Emitter};

use crate::config::DesktopConfig;
use crate::toast;

const INITIAL_RECONNECT_DELAY: Duration = Duration::from_secs(1);
const MAX_RECONNECT_DELAY: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotPayload {
    notifications: Vec<Notification>,
}

pub fn spawn(
    app: AppHandle,
    config: DesktopConfig,
    client: reqwest::Client,
    badge_cache_dir: PathBuf,
) {
    tauri::async_runtime::spawn(async move {
        run_sse_loop(app, config, client, badge_cache_dir).await;
    });
}

async fn run_sse_loop(
    app: AppHandle,
    config: DesktopConfig,
    client: reqwest::Client,
    badge_cache_dir: PathBuf,
) {
    let events_url = format!(
        "{}/api/notifications/events",
        config.api_base_url.trim_end_matches('/')
    );
    let mut last_event_id: Option<String> = None;
    let mut reconnect_delay = INITIAL_RECONNECT_DELAY;
    let mut toast_dedupe = ToastDedupe::new();

    loop {
        let mut parser = SseParser::new();
        let mut request = client
            .get(&events_url)
            .header(reqwest::header::ACCEPT, "text/event-stream");

        if let Some(cursor) = last_event_id.as_deref() {
            request = request.header("Last-Event-ID", cursor);
        }

        match request.send().await.and_then(reqwest::Response::error_for_status) {
            Ok(mut response) => {
                reconnect_delay = INITIAL_RECONNECT_DELAY;
                loop {
                    match response.chunk().await {
                        Ok(Some(chunk)) => match parser.feed(&chunk) {
                            Ok(events) => {
                                if let Some(cursor) = parser.last_event_id() {
                                    last_event_id = Some(cursor.to_string());
                                }
                                for event in events {
                                    if let Err(err) = handle_event(
                                        &app,
                                        &mut toast_dedupe,
                                        &badge_cache_dir,
                                        event,
                                    ) {
                                        eprintln!("failed to handle SSE event: {err}");
                                    }
                                }
                            }
                            Err(err) => {
                                eprintln!("failed to parse SSE chunk: {err}");
                                break;
                            }
                        },
                        Ok(None) => break,
                        Err(err) => {
                            eprintln!("SSE stream read failed: {err}");
                            break;
                        }
                    }
                }
            }
            Err(err) => {
                eprintln!("SSE connection failed: {err}");
            }
        }

        tokio::time::sleep(reconnect_delay).await;
        reconnect_delay = (reconnect_delay * 2).min(MAX_RECONNECT_DELAY);
    }
}

fn handle_event(
    app: &AppHandle,
    toast_dedupe: &mut ToastDedupe,
    badge_cache_dir: &Path,
    event: streamliner_core::sse::SseEvent,
) -> Result<(), String> {
    match event.event_name.as_str() {
        EVENT_SNAPSHOT => {
            let payload: SnapshotPayload = serde_json::from_value(event.data_json)
                .map_err(|err| format!("invalid snapshot payload: {err}"))?;
            // Snapshots are never toast-eligible; this only advances the
            // dedupe high-water mark so backlog items don't re-toast.
            let _ = toast_dedupe.process_event(EVENT_SNAPSHOT, &payload.notifications);
            app.emit(EVENT_SNAPSHOT, payload)
                .map_err(|err| format!("failed to emit snapshot: {err}"))
        }
        EVENT_NOTIFICATION_CREATED => {
            let notification: Notification = serde_json::from_value(event.data_json)
                .map_err(|err| format!("invalid notification payload: {err}"))?;
            // Toasting is best-effort and must never prevent the feed update:
            // attempt toasts, log failures, then always emit to the frontend.
            let eligible =
                toast_dedupe.process_event(EVENT_NOTIFICATION_CREATED, std::slice::from_ref(&notification));
            for record in eligible {
                if let Err(err) = toast::show_toast(record, badge_cache_dir) {
                    eprintln!("failed to show toast for notification {}: {err}", record.id);
                }
            }
            app.emit(EVENT_NOTIFICATION_CREATED, notification)
                .map_err(|err| format!("failed to emit notification.created: {err}"))
        }
        EVENT_HEARTBEAT => Ok(()),
        _ => Ok(()),
    }
}
