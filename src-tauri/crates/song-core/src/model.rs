use crate::Time;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

// This is an explicitly limited schema-7 fixture cohort, not a general importer.
// Unsupported tables must be present and empty; unknown fields are rejected.
macro_rules! data {
    ($name:ident { $($field:ident: $ty:ty),* $(,)? }) => {
        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        pub struct $name { $(pub $field: $ty),* }
    };
}
pub type Table<T> = BTreeMap<String, T>;
data!(Pitch {
    degree: i32,
    alteration: i32,
    octave: i32
});
data!(Note {
    id: String,
    pitch: Pitch
});
data!(Chord { id: String, name: String, label_tonic: Pitch, notes: Vec<Note>, label: Option<String> });
data!(Pattern { id: String, name: String, groups: Vec<Time>, length: Time, source_id: Option<String> });
data!(Performance {
    member_id: String,
    offset: Time,
    duration: Time
});
data!(MusicalEvent {
    id: String, name: String, origin_id: String, pattern_id: String,
    kind: String, start: Time, duration: Time, pitch: Pitch, chord_id: Option<String>,
    drum: String, accent: f64, articulation: String, performance: Vec<Performance>
});
data!(Bar { id: String, name: String, section_id: String, numerator: i32, denominator: i32, groups: Vec<i32>, actual: Option<Time> });
data!(Section { id: String, name: String, source_id: Option<String>, bar_ids: Vec<String> });
data!(Arrangement {
    id: String,
    name: String,
    section_id: String
});
data!(Part {
    id: String,
    name: String,
    instrument: String,
    volume: f64,
    muted: bool
});
data!(Voice {
    id: String,
    name: String,
    part_id: String
});
data!(Occurrence {
    id: String, name: String, section_id: Option<String>, pattern_id: String,
    voice_id: String, start: Time, span: Time, phase: Time, boundary: String, tails: String
});
data!(Writing {
    instructions: String,
    preferences: String
});
data!(Tempo {
    bpm: f64,
    beat_unit: Time
});
data!(Tables {
    patterns: Table<Pattern>, events: Table<MusicalEvent>, chords: Table<Chord>,
    bars: Table<Bar>, sections: Table<Section>, arrangement: Table<Arrangement>,
    parts: Table<Part>, voices: Table<Voice>, occurrences: Table<Occurrence>,
    prompts: Table<serde_json::Value>, assets: Table<serde_json::Value>,
    takes: Table<serde_json::Value>, fretted: Table<serde_json::Value>,
    fingerings: Table<serde_json::Value>, harmony: Table<serde_json::Value>,
    markers: Table<serde_json::Value>, phrases: Table<serde_json::Value>,
    lyrics: Table<serde_json::Value>, polyrhythms: Table<serde_json::Value>
});
data!(Song {
    schema_version: u32, id: String, title: String, mode: String,
    degree_reference: String, writing: Writing, tempo: Tempo,
    arrangement_order: Vec<String>, tables: Tables
});
