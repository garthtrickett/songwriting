use serde::{Deserialize, Serialize};
use song_core::{Action, Time};
use ts_rs::TS;

pub const PROTOCOL: u32 = 1;
pub const STATE_EVENT: &str = "desktop-state";

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProfileView {
    pub id: String,
    pub title: Option<String>,
    #[ts(type = "number | null")]
    pub revision: Option<u64>,
}

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

/// Derived read-only library views. These carry the tables the workbench panels
/// render. Rust stays the sole authority: every view is projected from accepted
/// model state and none of them is an editing path.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceView {
    pub id: String,
    pub name: String,
    pub section_id: String,
    pub section: String,
    #[ts(type = "number")]
    pub bars: usize,
    pub start: Time,
    pub length: Time,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MarkerView {
    pub id: String,
    pub name: String,
    pub at: Time,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationView {
    pub table: String,
    pub id: String,
    pub name: String,
    pub start: Time,
    pub duration: Time,
    pub appearance_id: String,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonyRegionView {
    pub id: String,
    pub name: String,
    pub section_id: Option<String>,
    pub section: Option<String>,
    pub start: Time,
    pub duration: Time,
    pub tonic: String,
    pub mode: String,
    pub annotation: String,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PartView {
    pub id: String,
    pub name: String,
    pub instrument: String,
    pub volume: f64,
    pub muted: bool,
    #[ts(type = "number")]
    pub voices: usize,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct VoiceView {
    pub id: String,
    pub name: String,
    pub part_id: String,
    pub part: String,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ChordView {
    pub id: String,
    pub name: String,
    pub label: Option<String>,
    pub tonic: String,
    pub notes: Vec<String>,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PolyrhythmLaneView {
    pub occurrence_id: String,
    pub occurrence: String,
    pub divisions: i32,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PolyrhythmView {
    pub id: String,
    pub name: String,
    pub section_id: Option<String>,
    pub section: Option<String>,
    pub start: Time,
    pub duration: Time,
    pub lanes: Vec<PolyrhythmLaneView>,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FrettedView {
    pub id: String,
    pub name: String,
    pub part_id: String,
    pub part: String,
    pub tonic: i32,
    pub tuning: Vec<i32>,
    pub capo: i32,
    pub max_fret: i32,
    pub hand_span: i32,
    #[ts(type = "number")]
    pub fingerings: usize,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TakeView {
    pub id: String,
    pub name: String,
    pub asset_id: String,
    pub asset: Option<String>,
    pub part_id: String,
    pub part: Option<String>,
    pub section: Option<String>,
    pub appearance_id: Option<String>,
    pub start: Time,
    pub at: Time,
    pub offset: f64,
    pub duration: f64,
    pub gain: f64,
    pub muted: bool,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct LyricView {
    pub id: String,
    pub name: String,
    pub section_id: String,
    pub section: Option<String>,
    pub start: Time,
    pub duration: Time,
    pub text: String,
    pub phrase_id: Option<String>,
    pub part_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PhraseView {
    pub id: String,
    pub name: String,
    pub section_id: String,
    pub section: Option<String>,
    pub start: Time,
    pub duration: Time,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PromptView {
    pub id: String,
    pub name: String,
    pub text: String,
}
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WritingView {
    pub instructions: String,
    pub preferences: String,
    pub mode: String,
    pub degree_reference: String,
    pub bpm: f64,
    pub beat_unit: Time,
}
impl Default for WritingView {
    fn default() -> Self {
        Self {
            instructions: String::new(),
            preferences: String::new(),
            mode: String::new(),
            degree_reference: String::new(),
            bpm: 0.0,
            beat_unit: Time::ZERO,
        }
    }
}
/// One grouped field keeps both Snapshot constructors honest: a new view cannot
/// be added to the projection and silently forgotten on the deleted-song path.
#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub appearances: Vec<AppearanceView>,
    pub markers: Vec<MarkerView>,
    pub annotations: Vec<AnnotationView>,
    pub harmony: Vec<HarmonyRegionView>,
    pub parts: Vec<PartView>,
    pub voices: Vec<VoiceView>,
    pub chords: Vec<ChordView>,
    pub polyrhythms: Vec<PolyrhythmView>,
    pub fretted: Vec<FrettedView>,
    pub takes: Vec<TakeView>,
    pub lyrics: Vec<LyricView>,
    pub phrases: Vec<PhraseView>,
    pub prompts: Vec<PromptView>,
    pub writing: WritingView,
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
    pub library: Library,
    pub undoable: Vec<UndoView>,
    pub redoable: Vec<UndoView>,
    pub warning: Option<String>,
}

#[derive(Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentView {
    pub configured_model: Option<String>,
    pub task: Option<TaskView>,
}
#[derive(Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TaskView {
    pub id: String,
    pub status: String,
    pub prompt: String,
    pub model: String,
    pub message: String,
    pub rounds: u32,
}
// No Debug/Serialize: credentials enter the host once and are never returned or
// written into workspace tasks. The proof uses session-only credential storage.
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentConfig {
    pub provider: String,
    pub model: String,
    pub api_key: String,
}
