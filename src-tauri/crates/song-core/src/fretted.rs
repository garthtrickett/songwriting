//! Fretted-instrument arrangement validation. Mirrors the validation half of
//! src/song/fretted.ts; position derivations arrive with slice 4 analysis.
use crate::{Result, Song, ensure, validate::identity};
use serde::Serialize;
use std::collections::BTreeSet;

pub const TECHNIQUES: [&str; 7] = [
    "pluck",
    "tap",
    "hammer-on",
    "pull-off",
    "slide",
    "mute",
    "let-ring",
];

const STANDARD_GUITAR: [i32; 6] = [64, 59, 55, 50, 45, 40];
const DROP_D: [i32; 6] = [64, 59, 55, 50, 45, 38];
const DADGAD: [i32; 6] = [62, 57, 55, 50, 45, 38];
const STANDARD_BASS: [i32; 4] = [43, 38, 33, 28];
const FIVE_STRING_BASS: [i32; 5] = [43, 38, 33, 28, 23];
pub const TUNINGS: [(&str, &[i32]); 5] = [
    ("Standard guitar", &STANDARD_GUITAR),
    ("Drop D", &DROP_D),
    ("DADGAD", &DADGAD),
    ("Standard bass", &STANDARD_BASS),
    ("Five-string bass", &FIVE_STRING_BASS),
];

pub fn connected(fingering: &crate::Fingering) -> bool {
    ["hammer-on", "pull-off", "slide"].contains(&fingering.technique.as_str())
}

fn integer(value: i32, lo: i32, hi: i32) -> bool {
    (lo..=hi).contains(&value)
}

pub(crate) fn validate_fretted(song: &Song) -> Result<()> {
    let tables = &song.tables;
    for arrangement in tables.fretted.values() {
        let part = tables.parts.get(&arrangement.part_id);
        ensure(
            part.is_some_and(|p| ["guitar", "bass"].contains(&p.instrument.as_str())),
            "Fretted arrangement needs a guitar/bass part",
        )?;
        ensure(
            integer(arrangement.tonic, 0, 127)
                && !arrangement.tuning.is_empty()
                && arrangement.tuning.len() <= 12
                && arrangement.tuning.iter().all(|n| integer(*n, 0, 127))
                && integer(arrangement.capo, 0, 24)
                && integer(arrangement.max_fret, arrangement.capo, 36)
                && integer(arrangement.hand_span, 1, 12),
            "Invalid tuning, tonic, capo, last fret or hand span",
        )?;
    }
    let mut targets = BTreeSet::new();
    for fingering in tables.fingerings.values() {
        ensure(
            tables.fretted.contains_key(&fingering.arrangement_id)
                && identity(&fingering.occurrence_id)
                && identity(&fingering.event_id)
                && fingering.member_id.as_deref().is_none_or(identity)
                && fingering.from_id.as_deref().is_none_or(identity)
                && integer(fingering.string, 1, 12)
                && integer(fingering.fret, 0, 36)
                && TECHNIQUES.contains(&fingering.technique.as_str()),
            "Invalid fingering shape or arrangement reference",
        )?;
        ensure(
            targets.insert((
                fingering.arrangement_id.clone(),
                fingering.occurrence_id.clone(),
                fingering.event_id.clone(),
                fingering.member_id.clone(),
            )),
            "One fingering per arrangement/placement/note",
        )?;
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FretPosition {
    pub string: i32,
    pub fret: i32,
    pub physical_fret: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FretOptions {
    pub pitch: crate::Pitch,
    pub midi: i32,
    pub positions: Vec<FretPosition>,
    pub unplayable: bool,
}

pub fn target_pitch(
    song: &Song,
    arrangement: &crate::Fretted,
    occurrence_id: &str,
    event_id: &str,
    member_id: Option<&str>,
) -> Result<crate::Pitch> {
    let (Some(occurrence), Some(event)) = (
        song.tables.occurrences.get(occurrence_id),
        song.tables.events.get(event_id),
    ) else {
        return Err(crate::Error::new(
            "invalid",
            "Stale placement/event or different part",
        ));
    };
    ensure(
        occurrence.pattern_id == event.pattern_id
            && song
                .tables
                .voices
                .get(&occurrence.voice_id)
                .is_some_and(|v| v.part_id == arrangement.part_id),
        "Stale placement/event or different part",
    )?;
    if event.kind == "note" && member_id.is_none() {
        return Ok(event.pitch.clone());
    }
    if event.kind == "chord"
        && let Some(note) = song.tables.chords[event.chord_id.as_deref().unwrap_or("")]
            .notes
            .iter()
            .find(|n| Some(n.id.as_str()) == member_id)
    {
        return Ok(note.pitch.clone());
    }
    Err(crate::Error::new(
        "invalid",
        "Stale or non-pitched note/member target",
    ))
}

pub fn fret_positions(
    song: &Song,
    arrangement_id: &str,
    occurrence_id: &str,
    event_id: &str,
    member_id: Option<&str>,
) -> Result<FretOptions> {
    let arrangement = song
        .tables
        .fretted
        .get(arrangement_id)
        .ok_or_else(|| crate::Error::new("invalid", "Unknown fretted arrangement"))?
        .clone();
    let pitch = target_pitch(song, &arrangement, occurrence_id, event_id, member_id)?;
    let midi = arrangement.tonic + crate::harmony_pitch::semitone(&pitch);
    let mut positions = Vec::new();
    for (i, open) in arrangement.tuning.iter().enumerate() {
        let fret = midi - open - arrangement.capo;
        if (0..=127).contains(&midi) && fret >= 0 && fret <= arrangement.max_fret - arrangement.capo
        {
            positions.push(FretPosition {
                string: i as i32 + 1,
                fret,
                physical_fret: fret + arrangement.capo,
            });
        }
    }
    Ok(FretOptions {
        pitch,
        midi,
        unplayable: positions.is_empty(),
        positions,
    })
}

pub fn fingering_issues(song: &Song, fingering: &crate::Fingering) -> Vec<String> {
    let arrangement = match song.tables.fretted.get(&fingering.arrangement_id) {
        Some(a) => a.clone(),
        None => return vec!["Unknown fretted arrangement".into()],
    };
    let mut issues = Vec::new();
    match fret_positions(
        song,
        &arrangement.id,
        &fingering.occurrence_id,
        &fingering.event_id,
        fingering.member_id.as_deref(),
    ) {
        Ok(options) => {
            if !options
                .positions
                .iter()
                .any(|p| p.string == fingering.string && p.fret == fingering.fret)
            {
                issues
                    .push("String/fret does not sound the current note in this tuning/key".into());
            }
        }
        Err(error) => issues.push(format!("Error: {error}")),
    }
    if fingering.string as usize > arrangement.tuning.len()
        || fingering.fret + arrangement.capo > arrangement.max_fret
    {
        issues.push("Position outside this instrument".into());
    }
    if connected(fingering) {
        let source = fingering
            .from_id
            .as_ref()
            .and_then(|id| song.tables.fingerings.get(id));
        let valid = match source {
            Some(source) => {
                source.id != fingering.id
                    && source.arrangement_id == arrangement.id
                    && source.string == fingering.string
                    && song
                        .tables
                        .occurrences
                        .get(&source.occurrence_id)
                        .map(|o| &o.voice_id)
                        == song
                            .tables
                            .occurrences
                            .get(&fingering.occurrence_id)
                            .map(|o| &o.voice_id)
            }
            None => false,
        };
        if !valid {
            issues.push(
                "Connected technique needs another source in the same arrangement, string and voice"
                    .into(),
            );
        } else {
            let source = source.unwrap();
            let bad = (fingering.technique == "hammer-on" && fingering.fret <= source.fret)
                || (fingering.technique == "pull-off" && fingering.fret >= source.fret)
                || (fingering.technique == "slide" && fingering.fret == source.fret);
            if bad {
                issues.push("Technique has incompatible fret direction".into());
            }
        }
    } else if fingering.from_id.is_some() {
        issues.push("Only a connected technique uses a source".into());
    }
    issues
}
