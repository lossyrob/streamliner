//! Native Windows toast emission. The XML composition and badge rendering live
//! in `streamliner-core` (portable, unit-tested); this module only performs the
//! WinRT `Show` call, gated to Windows. Elsewhere `show_toast` is a no-op so the
//! crate stays portable for CI.

use std::path::Path;

use streamliner_core::model::Notification;

const DEFAULT_COLOR: &str = "6D5DFB";
const BADGE_SIZE: u32 = 96;

#[cfg(target_os = "windows")]
pub fn show_toast(notification: &Notification, badge_cache_dir: &Path) -> Result<(), String> {
    use streamliner_core::badge::{badge_cache_path, derive_display_monogram, render_badge_cached};
    use streamliner_core::toast_xml::{build_toast_xml, file_uri, ToastContent};
    use windows::core::HSTRING;
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};

    use crate::activation::AUMID;

    let color = notification
        .workstream_color
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_COLOR);
    let monogram = derive_display_monogram(notification.workstream_short_name.as_deref());

    // Render (and persist) the badge first so the file exists on disk before the
    // toast references it; Windows reads appLogoOverride lazily and retains the
    // file for the Action Center, so the cache is never deleted.
    render_badge_cached(
        badge_cache_dir,
        color,
        &monogram,
        notification.event_kind,
        BADGE_SIZE,
    )
    .map_err(|err| format!("failed to render badge: {err}"))?;
    let logo_path = badge_cache_path(
        badge_cache_dir,
        color,
        &monogram,
        notification.event_kind,
        BADGE_SIZE,
    );
    let logo_uri = file_uri(&logo_path);

    let launch = format!("streamliner://notification/{}", notification.id);
    let attribution = match notification.workstream_short_name.as_deref() {
        Some(name) if !name.trim().is_empty() => {
            format!("{} / {}", name.trim(), notification.event_kind.as_str())
        }
        _ => notification.event_kind.as_str().to_string(),
    };

    let xml = build_toast_xml(&ToastContent {
        launch_url: &launch,
        logo_uri: &logo_uri,
        title: &notification.title,
        body: &notification.body,
        attribution: &attribution,
    });

    let doc = XmlDocument::new().map_err(|err| format!("XmlDocument::new failed: {err}"))?;
    doc.LoadXml(&HSTRING::from(xml))
        .map_err(|err| format!("XmlDocument::LoadXml failed: {err}"))?;
    let toast = ToastNotification::CreateToastNotification(&doc)
        .map_err(|err| format!("CreateToastNotification failed: {err}"))?;
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(AUMID))
        .map_err(|err| format!("CreateToastNotifierWithId failed: {err}"))?;
    notifier
        .Show(&toast)
        .map_err(|err| format!("ToastNotifier::Show failed: {err}"))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn show_toast(_notification: &Notification, _badge_cache_dir: &Path) -> Result<(), String> {
    // Toasts are Windows-only; other platforms keep the feed UI without toasts.
    Ok(())
}
