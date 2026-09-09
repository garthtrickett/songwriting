use serde::{Deserialize, Serialize};
use song_core::{Action, Time};
use ts_rs::TS;

pub const PROTOCOL: u32 = 1;
pub const STATE_EVENT: &str = "desktop-state";

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditRequest {
    pub protocol: u32,
    pub epoch: String,
    pub operation_id: String,
    #[ts(type = "number")]
    pub expected_revision: u64,
    pub label: String,
    pub action: Action,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub code: String,
    pub message: String,
}
impl From<song_core::Error> for Failure {
    fn from(error: song_core::Error) -> Self {
        Self {
            code: error.code.into(),
            message: error.message,
        }
    }
}
impl Failure {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NoteView {
    pub event_id: String,
    pub member_id: Option<String>,
    pub pattern_id: String,
    pub label: String,
    pub row: i32,
    pub start: Time,
    pub duration: Time,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PatternView {
    pub id: String,
    pub name: String,
    pub length: Time,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BarView {
    pub label: String,
    pub section: String,
    pub groups: Vec<i32>,
    pub start: Time,
    pub duration: Time,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PlacementView {
    pub id: String,
    pub name: String,
    pub voice: String,
    pub pattern_id: String,
    pub start: Time,
    pub duration: Time,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct UndoView {
    pub operation_id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub protocol: u32,
    pub epoch: String,
    pub profile: String,
    #[ts(type = "number")]
    pub revision: u64,
    pub title: String,
    pub patterns: Vec<PatternView>,
    pub notes: Vec<NoteView>,
    pub bars: Vec<BarView>,
    pub placements: Vec<PlacementView>,
    pub undoable: Vec<UndoView>,
    pub warning: Option<String>,
}
