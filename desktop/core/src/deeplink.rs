pub fn openable_link(link: Option<&str>) -> Option<String> {
    let trimmed = link?.trim();
    if trimmed.is_empty() {
        return None;
    }

    let colon = trimmed.find(':')?;
    let scheme = &trimmed[..colon];
    if scheme.is_empty()
        || !scheme
            .chars()
            .next()
            .is_some_and(|first| first.is_ascii_alphabetic())
        || scheme
            .chars()
            .any(|ch| !(ch.is_ascii_alphanumeric() || matches!(ch, '+' | '-' | '.')))
    {
        return None;
    }

    match scheme.to_ascii_lowercase().as_str() {
        "http" | "https" | "file" => Some(trimmed.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_only_http_https_and_file_schemes() {
        assert_eq!(
            openable_link(Some(" https://example.com/a ")).as_deref(),
            Some("https://example.com/a")
        );
        assert_eq!(
            openable_link(Some("http://example.com")).as_deref(),
            Some("http://example.com")
        );
        assert_eq!(
            openable_link(Some("file:///C:/Users/rob/file.txt")).as_deref(),
            Some("file:///C:/Users/rob/file.txt")
        );

        assert_eq!(openable_link(Some("javascript:alert(1)")), None);
        assert_eq!(openable_link(Some("C:\\Users\\rob\\file.txt")), None);
        assert_eq!(openable_link(Some("/relative/path")), None);
        assert_eq!(openable_link(Some("")), None);
        assert_eq!(openable_link(None), None);
    }
}
