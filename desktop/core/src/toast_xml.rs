//! Pure, platform-independent ToastGeneric XML composition.
//!
//! Keeping this off-Windows-testable isolates the string handling (escaping,
//! control-character sanitization, file-URI construction) from the WinRT
//! `Show` call, which lives in the desktop crate behind `#[cfg(windows)]`.

use std::path::Path;

use url::Url;

/// Inputs for a single ToastGeneric toast.
#[derive(Clone, Debug)]
pub struct ToastContent<'a> {
    /// Protocol-activation launch URL, e.g. `streamliner://notification/42`.
    pub launch_url: &'a str,
    /// `appLogoOverride` image source (a `file:///` URI to the badge PNG).
    pub logo_uri: &'a str,
    /// First text line (event title).
    pub title: &'a str,
    /// Second text line (body).
    pub body: &'a str,
    /// Attribution line, e.g. `WSA / pr-approved`.
    pub attribution: &'a str,
}

/// Build the ToastGeneric XML document for [`ToastContent`].
///
/// Title/body/attribution are sanitized of XML-invalid control characters and
/// then XML-escaped; the launch URL and logo URI are XML-escaped only (they are
/// produced internally and must not be mangled).
pub fn build_toast_xml(content: &ToastContent<'_>) -> String {
    let launch = escape_xml(content.launch_url);
    let logo = escape_xml(content.logo_uri);
    let title = escape_xml(&sanitize_text(content.title));
    let body = escape_xml(&sanitize_text(content.body));
    let attribution = escape_xml(&sanitize_text(content.attribution));

    format!(
        r#"<toast activationType="protocol" launch="{launch}">
  <visual>
    <binding template="ToastGeneric">
      <text>{title}</text>
      <text>{body}</text>
      <image placement="appLogoOverride" hint-crop="none" src="{logo}"/>
      <text placement="attribution">{attribution}</text>
    </binding>
  </visual>
</toast>"#
    )
}

/// Construct a `file:///` URI for an absolute path, robustly percent-encoding
/// the path. Falls back to a best-effort manual encoding if the platform path
/// can't be expressed as a URL (e.g. a relative path slipped through).
pub fn file_uri(path: impl AsRef<Path>) -> String {
    let path = path.as_ref();
    if let Ok(url) = Url::from_file_path(path) {
        return url.to_string();
    }
    let lossy = path.to_string_lossy().replace('\\', "/");
    let encoded = lossy
        .chars()
        .flat_map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '/' | '-' | '_' | '.' | '~' | ':') {
                vec![ch]
            } else {
                format!("%{:02X}", ch as u32 & 0xFF).chars().collect()
            }
        })
        .collect::<String>();
    format!("file:///{}", encoded.trim_start_matches('/'))
}

/// Escape the five XML metacharacters relevant to attribute and text content.
pub fn escape_xml(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}

/// Drop characters that XML 1.0 forbids (most C0 control codes), so a stray
/// control byte in a title/body can't make `XmlDocument::LoadXml` reject the
/// whole toast. Tab/newline/carriage-return are preserved.
pub fn sanitize_text(value: &str) -> String {
    value
        .chars()
        .filter(|&ch| {
            ch == '\t'
                || ch == '\n'
                || ch == '\r'
                || ('\u{20}'..='\u{D7FF}').contains(&ch)
                || ('\u{E000}'..='\u{FFFD}').contains(&ch)
                || ('\u{10000}'..='\u{10FFFF}').contains(&ch)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_all_xml_metacharacters() {
        assert_eq!(
            escape_xml(r#"a & b < c > d " e ' f"#),
            "a &amp; b &lt; c &gt; d &quot; e &apos; f"
        );
    }

    #[test]
    fn sanitize_strips_invalid_controls_but_keeps_whitespace() {
        let input = "ok\u{0007}\u{0000}line\ttab\nnew";
        assert_eq!(sanitize_text(input), "okline\ttab\nnew");
    }

    #[test]
    fn build_xml_escapes_user_text_and_preserves_structure() {
        let content = ToastContent {
            launch_url: "streamliner://notification/42",
            logo_uri: "file:///C:/Users/rob/badge.png",
            title: "PR <approved> & merged",
            body: "node \"x\"",
            attribution: "WSA / pr-approved",
        };
        let xml = build_toast_xml(&content);
        assert!(xml.contains(r#"launch="streamliner://notification/42""#));
        assert!(xml.contains("PR &lt;approved&gt; &amp; merged"));
        assert!(xml.contains("node &quot;x&quot;"));
        assert!(xml.contains(r#"src="file:///C:/Users/rob/badge.png""#));
        assert!(xml.contains(r#"activationType="protocol""#));
        // No raw user metacharacter leaks into the markup.
        assert!(!xml.contains("PR <approved>"));
    }

    #[test]
    fn file_uri_percent_encodes_spaces() {
        // Use an absolute path so Url::from_file_path succeeds on each platform.
        #[cfg(windows)]
        let path = Path::new(r"C:\Users\rob smith\badge.png");
        #[cfg(not(windows))]
        let path = Path::new("/home/rob smith/badge.png");
        let uri = file_uri(path);
        assert!(uri.starts_with("file:///"));
        assert!(uri.contains("rob%20smith"));
        assert!(!uri.contains(' '));
    }
}
