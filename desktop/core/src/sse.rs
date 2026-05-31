use serde_json::Value;
use std::error::Error;
use std::fmt;

pub const EVENT_SNAPSHOT: &str = "snapshot";
pub const EVENT_NOTIFICATION_CREATED: &str = "notification.created";
pub const EVENT_HEARTBEAT: &str = "heartbeat";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SseEvent {
    pub event_name: String,
    pub data_json: Value,
    pub last_event_id: Option<String>,
}

#[derive(Default)]
pub struct SseParser {
    buffer: String,
    event_name: Option<String>,
    data_lines: Vec<String>,
    pending_id: Option<String>,
    last_event_id: Option<String>,
}

#[derive(Debug)]
pub enum SseError {
    Utf8(std::str::Utf8Error),
    Json(serde_json::Error),
}

impl fmt::Display for SseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Utf8(err) => write!(f, "SSE chunk is not valid UTF-8: {err}"),
            Self::Json(err) => write!(f, "SSE data is not valid JSON: {err}"),
        }
    }
}

impl Error for SseError {}

impl From<std::str::Utf8Error> for SseError {
    fn from(value: std::str::Utf8Error) -> Self {
        Self::Utf8(value)
    }
}

impl From<serde_json::Error> for SseError {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}

impl SseParser {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn last_event_id(&self) -> Option<&str> {
        self.last_event_id.as_deref()
    }

    pub fn feed(&mut self, chunk: &[u8]) -> Result<Vec<SseEvent>, SseError> {
        self.buffer.push_str(std::str::from_utf8(chunk)?);
        let mut events = Vec::new();

        while let Some(line_end) = self.buffer.find('\n') {
            let mut line = self.buffer[..line_end].to_string();
            self.buffer.replace_range(..=line_end, "");
            if line.ends_with('\r') {
                line.pop();
            }
            if let Some(event) = self.process_line(&line)? {
                events.push(event);
            }
        }

        Ok(events)
    }

    fn process_line(&mut self, line: &str) -> Result<Option<SseEvent>, SseError> {
        if line.is_empty() {
            return self.dispatch();
        }
        if line.starts_with(':') {
            return Ok(None);
        }

        let (field, value) = match line.split_once(':') {
            Some((field, value)) => (field, value.strip_prefix(' ').unwrap_or(value)),
            None => (line, ""),
        };

        match field {
            "event" => self.event_name = Some(value.to_string()),
            "data" => self.data_lines.push(value.to_string()),
            "id" => self.pending_id = Some(value.to_string()),
            _ => {}
        }
        Ok(None)
    }

    fn dispatch(&mut self) -> Result<Option<SseEvent>, SseError> {
        if self.event_name.is_none() && self.data_lines.is_empty() && self.pending_id.is_none() {
            return Ok(None);
        }

        let event_name = self
            .event_name
            .take()
            .unwrap_or_else(|| "message".to_string());
        let data = self.data_lines.join("\n");
        self.data_lines.clear();
        let pending_id = self.pending_id.take();

        if event_name == EVENT_NOTIFICATION_CREATED {
            if let Some(id) = pending_id {
                self.last_event_id = Some(id);
            }
        }

        let data_json = if data.is_empty() {
            Value::Null
        } else {
            serde_json::from_str(&data)?
        };

        Ok(Some(SseEvent {
            event_name,
            data_json,
            last_event_id: self.last_event_id.clone(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_events_across_chunk_boundaries() {
        let mut parser = SseParser::new();
        assert!(parser.feed(b"event: notification.cre").unwrap().is_empty());
        assert!(parser
            .feed(b"ated\nid: 42\ndata: {\"id\":42,\"title\":\"")
            .unwrap()
            .is_empty());
        let events = parser.feed(b"ok\"}\n\n").unwrap();

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_name, EVENT_NOTIFICATION_CREATED);
        assert_eq!(events[0].data_json["id"], 42);
        assert_eq!(events[0].last_event_id.as_deref(), Some("42"));
        assert_eq!(parser.last_event_id(), Some("42"));
    }

    #[test]
    fn heartbeat_and_snapshot_do_not_advance_last_event_id() {
        let mut parser = SseParser::new();
        parser
            .feed(b"event: notification.created\nid: 5\ndata: {\"id\":5}\n\n")
            .unwrap();
        let events = parser
            .feed(
                b"event: heartbeat\ndata: {}\n\nevent: snapshot\ndata: {\"notifications\":[]}\n\n",
            )
            .unwrap();

        assert_eq!(events.len(), 2);
        assert_eq!(events[0].event_name, EVENT_HEARTBEAT);
        assert_eq!(events[0].last_event_id.as_deref(), Some("5"));
        assert_eq!(events[1].event_name, EVENT_SNAPSHOT);
        assert_eq!(events[1].last_event_id.as_deref(), Some("5"));
        assert_eq!(parser.last_event_id(), Some("5"));
    }
}
