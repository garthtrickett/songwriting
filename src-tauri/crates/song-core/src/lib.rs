//! D1 headless SAM musical slice. No device, UI, database or agent dependencies.
mod actions;
mod arrangement;
mod chord_builder;
mod fretted;
mod harmony;
mod harmony_analysis;
mod harmony_pitch;
mod model;
mod note_edit;
mod rhythm;
mod rhythm_analysis;
mod structure;
mod time;
mod timeline;
mod validate;
mod voice_leading;

pub use actions::{Action, Delta, Envelope, Mutation, Receipt, StackEntry, State, history_stacks};
pub use arrangement::{
    Annotation, Placement, annotations, placements, section_length, section_spans,
};
pub use harmony::HarmonyAction;
pub use harmony_analysis::{
    ChordCandidates, HarmonicContext, HarmonicSpan, Interpretations, SoundingHarmony, SoundingNote,
    SoundingVoice, chord_candidates, harmonic_context, harmonic_spans, interpretations,
    sounding_harmony,
};
pub use model::*;
pub use note_edit::{NoteEdit, NoteTarget, WireChange, change_notes, combine_notes, remove_notes};
pub use rhythm::{RhythmAction, RhythmLane};
pub use rhythm_analysis::{
    AlignmentLaneView, AlignmentMap, GridAppearance, GridLane, PatternComparison, PatternRow,
    alignment_map, compare_patterns, polyrhythm_grid,
};
pub use structure::StructureAction;
pub use time::{MAX_SAFE_INTEGER, Time};
pub use timeline::{
    alignment, bars, clicks, cycle_starts, rest_spans, seconds_per_quarter, segments, song_end,
    sounds,
};

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Error {
    pub code: &'static str,
    pub message: String,
}

impl Error {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}
impl std::error::Error for Error {}
impl From<serde_json::Error> for Error {
    fn from(error: serde_json::Error) -> Self {
        Self::new("invalid", error.to_string())
    }
}
pub type Result<T> = std::result::Result<T, Error>;

pub(crate) fn ensure(condition: bool, message: &str) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(Error::new("invalid", message))
    }
}

pub(crate) fn lookup<'a, T>(
    map: &'a std::collections::BTreeMap<String, T>,
    table: &str,
    id: &str,
) -> Result<&'a T> {
    map.get(id)
        .ok_or_else(|| Error::new("invalid", format!("Unknown {table} {id}")))
}
