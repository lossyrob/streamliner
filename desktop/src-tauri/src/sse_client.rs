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
                                    match handle_event(
                                        &app,
                                        &mut toast_dedupe,
                                        &badge_cache_dir,
                                        event,
                                    ) {
                                        // A snapshot carries no SSE id; seed the
                                        // cursor from its max id (only while the
                                        // cursor is still unset — the server only
                                        // sends a snapshot when no Last-Event-ID
                                        // was supplied) so a later reconnect
                                        // resumes (replaying missed events as
                                        // toast-eligible `created`s) instead of
                                        // re-fetching a non-eligible snapshot and
                                        // dropping the toast.
                                        Ok(Some(cursor)) => {
                                            if last_event_id.is_none() {
                                                last_event_id = Some(cursor);
                                            }
                                        }
                                        Ok(None) => {}
                                        Err(err) => {
                                            eprintln!("failed to handle SSE event: {err}");
                                        }
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
) -> Result<Option<String>, String> {
    match event.event_name.as_str() {
        EVENT_SNAPSHOT => {
            let payload: SnapshotPayload = serde_json::from_value(event.data_json)
                .map_err(|err| format!("invalid snapshot payload: {err}"))?;
            // Snapshots are never toast-eligible; this only advances the
            // dedupe high-water mark so backlog items don't re-toast.
            let _ = toast_dedupe.process_event(EVENT_SNAPSHOT, &payload.notifications);
            let cursor = snapshot_cursor(&payload.notifications);
            app.emit(EVENT_SNAPSHOT, payload)
                .map_err(|err| format!("failed to emit snapshot: {err}"))?;
            Ok(cursor)
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
                .map_err(|err| format!("failed to emit notification.created: {err}"))?;
            // The SSE `id:` field already advances the cursor for created events.
            Ok(None)
        }
        EVENT_HEARTBEAT => Ok(None),
        _ => Ok(None),
    }
}

/// Largest notification id in a snapshot, rendered as an SSE cursor string.
fn snapshot_cursor(notifications: &[Notification]) -> Option<String> {
    notifications
        .iter()
        .map(|notification| notification.id)
        .max()
        .map(|id| id.to_string())
}

#[cfg(test)]
mod tests {
    use super::snapshot_cursor;
    use streamliner_core::model::{EventKind, Notification, Severity};

    fn notification(id: u64) -> Notification {
        Notification {
            id,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            title: format!("n{id}"),
            body: String::new(),
            severity: Severity::Info,
            event_kind: EventKind::Generic,
            workstream_id: None,
            project_key: None,
            workstream_color: None,
            workstream_short_name: None,
            node_id: None,
            session_id: None,
            link: None,
            source: "test".to_string(),
        }
    }

    #[test]
    fn snapshot_cursor_returns_max_id() {
        assert_eq!(snapshot_cursor(&[]), None);
        assert_eq!(
            snapshot_cursor(&[notification(3), notification(7), notification(5)]).as_deref(),
            Some("7")
        );
    }
}
