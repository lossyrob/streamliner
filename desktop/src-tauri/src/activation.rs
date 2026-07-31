//! Protocol activation: per-user AUMID + `streamliner://` scheme registration,
//! launch-argument parsing, and `<id>` -> link resolution + open. The parsing
//! and resolution paths are portable (and unit-tested); the registry writes and
//! AUMID association are Windows-only.

use std::path::Path;

use serde::Deserialize;

use streamliner_core::deeplink::openable_link;
use streamliner_core::model::Notification;

/// Stable per-user application id (matches the Tauri bundle identifier).
pub const AUMID: &str = "com.streamliner.desktop";
/// Custom URL scheme used for toast click-through.
pub const PROTOCOL: &str = "streamliner";

#[derive(Debug, Deserialize)]
struct NotificationGetResponse {
    notification: Notification,
}

/// Parse a `streamliner://notification/<id>` activation URL into its id.
/// Returns `None` for any other URL, a missing/zero id, or a non-numeric id.
pub fn parse_notification_id(arg: &str) -> Option<u64> {
    let trimmed = arg.trim();
    let prefix = format!("{PROTOCOL}://notification/");
    // Scheme/host are case-insensitive. Compare bytes (an `&str` slice at an
    // arbitrary byte index panics inside a multi-byte codepoint, and this URL is
    // attacker-reachable via the registered protocol handler). Slicing the
    // original `&str` at `prefix.len()` is char-boundary-safe only AFTER the
    // ASCII prefix matched byte-for-byte.
    let prefix_bytes = prefix.as_bytes();
    let trimmed_bytes = trimmed.as_bytes();
    if trimmed_bytes.len() < prefix_bytes.len()
        || !trimmed_bytes[..prefix_bytes.len()].eq_ignore_ascii_case(prefix_bytes)
    {
        return None;
    }
    let rest = &trimmed[prefix.len()..];
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    let id: u64 = digits.parse().ok()?;
    (id > 0).then_some(id)
}

/// First process/forwarded argument that is a notification activation URL.
pub fn activation_arg<I>(args: I) -> Option<String>
where
    I: IntoIterator<Item = String>,
{
    args.into_iter()
        .find(|arg| parse_notification_id(arg).is_some())
}

/// Resolve `<id>` to its deep link via the local API and open it. Best-effort:
/// failures are logged, never propagated (activation must not crash the app).
pub async fn activate(api_base_url: String, http: reqwest::Client, id: u64) {
    match resolve_link(&api_base_url, &http, id).await {
        Ok(Some(link)) => match openable_link(Some(&link)) {
            Some(url) => {
                if let Err(err) = open::that_detached(&url) {
                    eprintln!("activation: failed to open link for notification {id}: {err}");
                }
            }
            None => eprintln!("activation: notification {id} link is not openable: {link}"),
        },
        Ok(None) => eprintln!("activation: notification {id} has no link to open"),
        Err(err) => eprintln!("activation: failed to resolve notification {id}: {err}"),
    }
}

async fn resolve_link(
    api_base_url: &str,
    http: &reqwest::Client,
    id: u64,
) -> Result<Option<String>, String> {
    let url = format!(
        "{}/api/notifications/{id}",
        api_base_url.trim_end_matches('/')
    );
    let response = http
        .get(url)
        .send()
        .await
        .map_err(|err| err.to_string())?
        .error_for_status()
        .map_err(|err| err.to_string())?;
    let body = response
        .json::<NotificationGetResponse>()
        .await
        .map_err(|err| err.to_string())?;
    if body.notification.id != id {
        return Err(format!(
            "server returned notification {} for requested {id}",
            body.notification.id
        ));
    }
    Ok(body.notification.link)
}

/// Associate the current process with the AUMID so toasts carry the app
/// identity. No-op on non-Windows.
#[cfg(target_os = "windows")]
pub fn set_process_aumid() {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    if let Err(err) = unsafe { SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(AUMID)) } {
        eprintln!("activation: SetCurrentProcessExplicitAppUserModelID failed: {err}");
    }
}

#[cfg(not(target_os = "windows"))]
pub fn set_process_aumid() {}

/// Idempotently register the per-user AUMID and `streamliner://` scheme in
/// `HKCU` (no admin required). No-op on non-Windows.
#[cfg(target_os = "windows")]
pub fn register(exe: &Path, icon: &Path) -> std::io::Result<()> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    let (aumid_key, _) =
        hkcu.create_subkey(format!(r"Software\Classes\AppUserModelId\{AUMID}"))?;
    aumid_key.set_value("DisplayName", &"Streamliner")?;
    aumid_key.set_value("IconUri", &icon.display().to_string())?;
    aumid_key.set_value("IconBackgroundColor", &"0")?;

    let (proto_key, _) = hkcu.create_subkey(format!(r"Software\Classes\{PROTOCOL}"))?;
    proto_key.set_value("", &"URL:Streamliner Protocol")?;
    proto_key.set_value("URL Protocol", &"")?;
    let (command_key, _) =
        hkcu.create_subkey(format!(r"Software\Classes\{PROTOCOL}\shell\open\command"))?;
    command_key.set_value("", &format!("\"{}\" \"%1\"", exe.display()))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn register(_exe: &Path, _icon: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_activation_urls() {
        assert_eq!(parse_notification_id("streamliner://notification/42"), Some(42));
        assert_eq!(
            parse_notification_id("  streamliner://notification/7/  "),
            Some(7)
        );
        assert_eq!(
            parse_notification_id("STREAMLINER://NOTIFICATION/9"),
            Some(9)
        );
        assert_eq!(
            parse_notification_id("streamliner://notification/12?foo=bar"),
            Some(12)
        );
    }

    #[test]
    fn rejects_invalid_or_zero_ids_and_other_urls() {
        assert_eq!(parse_notification_id("streamliner://notification/0"), None);
        assert_eq!(parse_notification_id("streamliner://notification/"), None);
        assert_eq!(parse_notification_id("streamliner://notification/abc"), None);
        assert_eq!(parse_notification_id("streamliner://other/1"), None);
        assert_eq!(parse_notification_id("https://example.com/notification/1"), None);
        assert_eq!(parse_notification_id(""), None);
    }

    #[test]
    fn does_not_panic_on_multibyte_urls() {
        // The protocol handler is attacker-reachable; a multi-byte codepoint
        // straddling the prefix-length byte boundary must not panic.
        assert_eq!(parse_notification_id("streamliner://\u{f1}\u{f1}\u{f1}\u{f1}\u{f1}\u{f1}\u{f1}"), None);
        assert_eq!(parse_notification_id("str\u{e9}amliner://notification/1"), None);
        assert_eq!(parse_notification_id("\u{1f600}"), None);
        // Valid id still parses when followed by multi-byte trailing junk.
        assert_eq!(parse_notification_id("streamliner://notification/7\u{f1}x"), Some(7));
    }

    #[test]
    fn activation_arg_finds_protocol_url_among_args() {
        let args = vec![
            "streamliner-desktop.exe".to_string(),
            "--flag".to_string(),
            "streamliner://notification/5".to_string(),
        ];
        assert_eq!(
            activation_arg(args).as_deref(),
            Some("streamliner://notification/5")
        );
        assert_eq!(activation_arg(vec!["exe".to_string()]), None);
    }
}
