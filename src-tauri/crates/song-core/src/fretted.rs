//! Fretted-instrument arrangement validation. Mirrors the validation half of
//! src/song/fretted.ts; position derivations arrive with slice 4 analysis.
use crate::{Result, Song, ensure, validate::identity};
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
