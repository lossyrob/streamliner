use crate::model::Notification;
use crate::sse::{EVENT_NOTIFICATION_CREATED, EVENT_SNAPSHOT};

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ToastDedupe {
    high_water_mark: Option<u64>,
}

impl ToastDedupe {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn high_water_mark(&self) -> Option<u64> {
        self.high_water_mark
    }

    pub fn process_event<'a>(
        &mut self,
        event_name: &str,
        notifications: &'a [Notification],
    ) -> Vec<&'a Notification> {
        match event_name {
            EVENT_NOTIFICATION_CREATED => notifications
                .iter()
                .filter(|notification| self.record_created(notification.id))
                .collect(),
            EVENT_SNAPSHOT => {
                for notification in notifications {
                    self.record_seen(notification.id);
                }
                Vec::new()
            }
            _ => Vec::new(),
        }
    }

    fn record_created(&mut self, id: u64) -> bool {
        let eligible = self.high_water_mark.is_none_or(|high| id > high);
        self.record_seen(id);
        eligible
    }

    fn record_seen(&mut self, id: u64) {
        self.high_water_mark = Some(self.high_water_mark.map_or(id, |high| high.max(id)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{EventKind, Severity};

    fn notification(id: u64) -> Notification {
        Notification {
            id,
            created_at: "2026-05-30T00:00:00.000Z".to_string(),
            title: format!("title {id}"),
            body: "body".to_string(),
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
    fn only_created_events_are_toast_eligible_and_replays_are_suppressed() {
        let mut dedupe = ToastDedupe::new();
        let first = notification(10);
        let replay = notification(10);
        let next = notification(11);

        assert_eq!(
            dedupe.process_event(EVENT_NOTIFICATION_CREATED, &[first]).len(),
            1
        );
        assert_eq!(
            dedupe.process_event(EVENT_NOTIFICATION_CREATED, &[replay]).len(),
            0
        );
        assert_eq!(
            dedupe.process_event(EVENT_NOTIFICATION_CREATED, &[next]).len(),
            1
        );
        assert_eq!(dedupe.high_water_mark(), Some(11));
    }

    #[test]
    fn snapshot_with_high_ids_is_never_toast_eligible() {
        let mut dedupe = ToastDedupe::new();
        let seen = notification(5);
        assert_eq!(
            dedupe.process_event(EVENT_NOTIFICATION_CREATED, &[seen]).len(),
            1
        );

        let backlog = [notification(100), notification(101)];
        assert_eq!(dedupe.process_event(EVENT_SNAPSHOT, &backlog).len(), 0);
        assert_eq!(dedupe.high_water_mark(), Some(101));
    }
}
