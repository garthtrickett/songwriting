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

/// Display label for a relative pitch, mirroring pitchLabel in model.ts.
pub fn pitch_label(pitch: &Pitch) -> String {
    let accidental = if pitch.alteration < 0 {
        "♭".repeat((-pitch.alteration) as usize)
    } else {
        "♯".repeat(pitch.alteration as usize)
    };
    let octave = if pitch.octave == 0 {
        String::new()
    } else if pitch.octave > 0 {
        format!("↑{}", pitch.octave)
    } else {
        format!("↓{}", -pitch.octave)
    };
    format!("{accidental}{}{octave}", pitch.degree)
}
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
/// Optional performance overrides omit absent keys, matching the reference
/// JSON shape; deserialization still accepts explicit nulls.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Performance {
    pub member_id: String,
    pub offset: Time,
    pub duration: Time,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gain: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub articulation: Option<String>,
}
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
data!(HarmonicRegion {
    id: String, name: String, section_id: Option<String>,
    start: Time, duration: Time, tonic: Pitch, mode: String, annotation: String
});
data!(Marker {
    id: String,
    name: String,
    at: Time
});
data!(Phrase {
    id: String,
    name: String,
    section_id: String,
    start: Time,
    duration: Time
});
data!(Lyric {
    id: String, name: String, section_id: String, start: Time, duration: Time,
    text: String, phrase_id: Option<String>, part_id: Option<String>
});
data!(PolyrhythmLane {
    occurrence_id: String,
    divisions: i32
});
data!(Polyrhythm {
    id: String, name: String, section_id: Option<String>,
    start: Time, duration: Time, lanes: Vec<PolyrhythmLane>
});
data!(Fretted {
    id: String, name: String, part_id: String, tonic: i32, tuning: Vec<i32>,
    capo: i32, max_fret: i32, hand_span: i32
});
data!(Fingering {
    id: String, name: String, arrangement_id: String, occurrence_id: String,
    event_id: String, member_id: Option<String>, string: i32, fret: i32,
    technique: String, from_id: Option<String>
});
data!(Prompt {
    id: String,
    name: String,
    text: String
});
data!(AudioAsset {
    id: String,
    name: String,
    mime: String,
    bytes: u32,
    duration: f64
});
data!(Take {
    id: String, name: String, asset_id: String, part_id: String,
    section_id: Option<String>, start: Time, offset: f64, duration: f64,
    gain: f64, muted: bool
});
data!(Tempo {
    bpm: f64,
    beat_unit: Time
});
data!(Tables {
    patterns: Table<Pattern>, events: Table<MusicalEvent>, chords: Table<Chord>,
    bars: Table<Bar>, sections: Table<Section>, arrangement: Table<Arrangement>,
    parts: Table<Part>, voices: Table<Voice>, occurrences: Table<Occurrence>,
    prompts: Table<Prompt>, assets: Table<AudioAsset>,
    takes: Table<Take>, fretted: Table<Fretted>,
    fingerings: Table<Fingering>, harmony: Table<HarmonicRegion>,
    markers: Table<Marker>, phrases: Table<Phrase>,
    lyrics: Table<Lyric>, polyrhythms: Table<Polyrhythm>
});
data!(Song {
    schema_version: u32, id: String, title: String, mode: String,
    degree_reference: String, writing: Writing, tempo: Tempo,
    arrangement_order: Vec<String>, tables: Tables
});
