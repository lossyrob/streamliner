use serde::Deserialize;
use tauri::State;

use crate::{config::DesktopConfig, AppState};
use streamliner_core::{
    badge::{derive_display_monogram, render_badge},
    deeplink::openable_link,
    model::{EventKind, Notification},
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotificationListResponse {
    notifications: Vec<Notification>,
}

#[tauri::command]
pub fn app_config(state: State<'_, AppState>) -> DesktopConfig {
    state.config.clone()
}

#[tauri::command]
pub async fn list_notifications(
    after_id: Option<u64>,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Vec<Notification>, String> {
    let mut url = reqwest::Url::parse(&format!(
        "{}/api/notifications",
        state.config.api_base_url.trim_end_matches('/')
    ))
    .map_err(|err| format!("invalid API base URL: {err}"))?;

    {
        let mut query = url.query_pairs_mut();
        if let Some(after_id) = after_id {
            query.append_pair("afterId", &after_id.to_string());
        }
        if let Some(limit) = limit {
            query.append_pair("limit", &limit.to_string());
        }
    }

    let response = state
        .http
        .get(url)
        .send()
        .await
        .map_err(|err| format!("failed to list notifications: {err}"))?
        .error_for_status()
        .map_err(|err| format!("notification list request failed: {err}"))?;

    let body = response
        .json::<NotificationListResponse>()
        .await
        .map_err(|err| format!("invalid notification list response: {err}"))?;
    Ok(body.notifications)
}

#[tauri::command]
pub fn open_link(link: Option<String>) -> Result<(), String> {
    let Some(url) = openable_link(link.as_deref()) else {
        return Err("notification link is not openable".to_string());
    };
    open::that_detached(url).map_err(|err| format!("failed to open notification link: {err}"))
}

#[tauri::command]
pub fn notification_badge(
    color_hex: Option<String>,
    monogram: Option<String>,
    event_kind: String,
    size_px: Option<u32>,
) -> Result<Vec<u8>, String> {
    let event_kind = parse_event_kind(&event_kind);
    let color_hex = color_hex
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("6D5DFB");
    let monogram = derive_display_monogram(monogram.as_deref());
    Ok(render_badge(
        color_hex,
        &monogram,
        event_kind,
        size_px.unwrap_or(48),
    ))
}

fn parse_event_kind(value: &str) -> EventKind {
    EventKind::ALL
        .into_iter()
        .find(|kind| kind.as_str() == value)
        .unwrap_or(EventKind::Generic)
}
