use std::time::Duration;

use serde::{Deserialize, Serialize};
use streamliner_core::{
    dedupe::ToastDedupe,
    model::Notification,
    sse::{SseParser, EVENT_HEARTBEAT, EVENT_NOTIFICATION_CREATED, EVENT_SNAPSHOT},
};
use tauri::{AppHandle, Emitter};

use crate::config::DesktopConfig;

const INITIAL_RECONNECT_DELAY: Duration = Duration::from_secs(1);
const MAX_RECONNECT_DELAY: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotPayload {
    notifications: Vec<Notification>,
}

pub fn spawn(app: AppHandle, config: DesktopConfig, client: reqwest::Client) {
    tauri::async_runtime::spawn(async move {
        run_sse_loop(app, config, client).await;
    });
}

async fn run_sse_loop(app: AppHandle, config: DesktopConfig, client: reqwest::Client) {
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
                                    if let Err(err) = handle_event(&app, &mut toast_dedupe, event) {
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
    event: streamliner_core::sse::SseEvent,
) -> Result<(), String> {
    match event.event_name.as_str() {
        EVENT_SNAPSHOT => {
            let payload: SnapshotPayload = serde_json::from_value(event.data_json)
                .map_err(|err| format!("invalid snapshot payload: {err}"))?;
            toast_hook_noop(toast_dedupe, EVENT_SNAPSHOT, &payload.notifications);
            app.emit(EVENT_SNAPSHOT, payload)
                .map_err(|err| format!("failed to emit snapshot: {err}"))
        }
        EVENT_NOTIFICATION_CREATED => {
            let notification: Notification = serde_json::from_value(event.data_json)
                .map_err(|err| format!("invalid notification payload: {err}"))?;
            toast_hook_noop(
                toast_dedupe,
                EVENT_NOTIFICATION_CREATED,
                std::slice::from_ref(&notification),
            );
            app.emit(EVENT_NOTIFICATION_CREATED, notification)
                .map_err(|err| format!("failed to emit notification.created: {err}"))
        }
        EVENT_HEARTBEAT => Ok(()),
        _ => Ok(()),
    }
}

fn toast_hook_noop(
    toast_dedupe: &mut ToastDedupe,
    event_name: &str,
    notifications: &[Notification],
) {
    // Phase 4a hook point: 4b will emit native Windows toasts here. For now this
    // intentionally only updates dedupe state; it never displays a toast.
    let _toast_eligible = toast_dedupe.process_event(event_name, notifications);
}
