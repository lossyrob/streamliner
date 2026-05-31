use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub id: u64,
    pub created_at: String,
    pub title: String,
    pub body: String,
    pub severity: Severity,
    pub event_kind: EventKind,
    pub workstream_id: Option<String>,
    pub project_key: Option<String>,
    pub workstream_color: Option<String>,
    pub workstream_short_name: Option<String>,
    pub node_id: Option<String>,
    pub session_id: Option<String>,
    pub link: Option<String>,
    pub source: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Severity {
    Info,
    Warn,
    Error,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EventKind {
    Online,
    PrCreated,
    PrApproved,
    IssueClosed,
    Reconciled,
    Done,
    #[serde(other)]
    Generic,
}

impl EventKind {
    pub const ALL: [Self; 7] = [
        Self::Online,
        Self::PrCreated,
        Self::PrApproved,
        Self::IssueClosed,
        Self::Reconciled,
        Self::Done,
        Self::Generic,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Online => "online",
            Self::PrCreated => "pr-created",
            Self::PrApproved => "pr-approved",
            Self::IssueClosed => "issue-closed",
            Self::Reconciled => "reconciled",
            Self::Done => "done",
            Self::Generic => "generic",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_kind_round_trips_and_unknown_falls_back_to_generic() {
        for kind in EventKind::ALL {
            let json = serde_json::to_string(&kind).unwrap();
            assert_eq!(serde_json::from_str::<EventKind>(&json).unwrap(), kind);
        }

        assert_eq!(
            serde_json::from_str::<EventKind>("\"future-kind\"").unwrap(),
            EventKind::Generic
        );
        assert_eq!(
            serde_json::to_string(&EventKind::Generic).unwrap(),
            "\"generic\""
        );
    }

    #[test]
    fn notification_uses_camel_case_and_null_options() {
        let json = r#"{
            "id": 7,
            "createdAt": "2026-05-30T00:00:00.000Z",
            "title": "Title",
            "body": "Body",
            "severity": "info",
            "eventKind": "pr-created",
            "workstreamId": null,
            "projectKey": null,
            "workstreamColor": "6D5DFB",
            "workstreamShortName": "STR",
            "nodeId": null,
            "sessionId": null,
            "link": null,
            "source": "test"
        }"#;

        let record: Notification = serde_json::from_str(json).unwrap();
        assert_eq!(record.created_at, "2026-05-30T00:00:00.000Z");
        assert_eq!(record.event_kind, EventKind::PrCreated);
        assert_eq!(record.workstream_id, None);
        assert_eq!(record.workstream_color.as_deref(), Some("6D5DFB"));
    }
}
