pub mod badge;
pub mod dedupe;
pub mod deeplink;
pub mod model;
pub mod sse;
pub mod toast_xml;

pub use badge::{
    badge_cache_path, derive_display_monogram, render_badge, render_badge_cached,
};
pub use dedupe::ToastDedupe;
pub use deeplink::openable_link;
pub use model::{EventKind, Notification, Severity};
pub use sse::{SseEvent, SseParser};
pub use toast_xml::{build_toast_xml, file_uri, ToastContent};
