//! Harmony transformations: chord building, transposition, voice leading,
//! member performance and expression ramps. Mirrors harmonyChanges in
//! harmony.ts.
use crate::{
    Result, Song, Time,
    chord_builder::build_chord,
    harmony_pitch::{integer_value, shift_pitch},
    voice_leading::voice_leading,
};
use crate::{ensure, lookup};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum HarmonyAction {
    Build {
        new_id: String,
        name: String,
        recipe: crate::chord_builder::ChordRecipe,
        event_id: Option<String>,
        performance: String,
    },
    Transpose {
        pattern_id: String,
        new_id: String,
        steps: f64,
        semitones: f64,
    },
    VoiceLead {
        source_id: String,
        target_id: String,
        octave_radius: i32,
    },
    Perform {
        event_id: String,
        order: Vec<String>,
        step: Time,
        duration: Option<Time>,
    },
    Expression {
        event_ids: Vec<String>,
        from: f64,
        to: f64,
        articulation: String,
        gate: Time,
    },
}

fn fresh(song: &Song, id: &str, limit: usize) -> Result<()> {
    ensure(
        crate::validate::identity(id) && id.len() <= limit,
        "Choose a new unique ID within supported length",
    )?;
    let t = &song.tables;
    ensure(
        !(t.patterns.contains_key(id)
            || t.events.contains_key(id)
            || t.chords.contains_key(id)
            || t.bars.contains_key(id)
            || t.sections.contains_key(id)
            || t.arrangement.contains_key(id)
            || t.parts.contains_key(id)
            || t.voices.contains_key(id)
            || t.occurrences.contains_key(id)
            || t.prompts.contains_key(id)
            || t.harmony.contains_key(id)
            || t.markers.contains_key(id)
            || t.phrases.contains_key(id)
            || t.lyrics.contains_key(id)
            || t.polyrhythms.contains_key(id)
            || t.fretted.contains_key(id)
            || t.fingerings.contains_key(id)
            || t.assets.contains_key(id)
            || t.takes.contains_key(id)),
        "Choose a new unique ID within supported length",
    )?;
    Ok(())
}

fn positive(time: Time) -> Result<()> {
    ensure(
        time > Time::ZERO,
        "Use normalized nonnegative time; duration must be positive",
    )
}

pub fn harmony(song: &mut Song, action: &HarmonyAction) -> Result<()> {
    match action {
        HarmonyAction::Build {
            new_id,
            name,
            recipe,
            event_id,
            performance,
        } => {
            fresh(song, new_id, 70)?;
            ensure(
                ["reset", "reject"].contains(&performance.as_str()),
                "Choose member performance handling",
            )?;
            let chord = build_chord(new_id.clone(), name.clone(), recipe)?;
            song.tables.chords.insert(new_id.clone(), chord);
            if let Some(event_id) = event_id {
                let mut event = lookup(&song.tables.events, "event", event_id)?.clone();
                ensure(event.kind == "chord", "Choose a chord event")?;
                ensure(
                    event.performance.is_empty() || performance == "reset",
                    "Event has member performance; explicitly reset it before replacing the chord",
                )?;
                event.chord_id = Some(new_id.clone());
                event.performance = vec![];
                song.tables.events.insert(event.id.clone(), event);
            }
        }
        HarmonyAction::Transpose {
            pattern_id,
            new_id,
            steps,
            semitones,
        } => {
            let steps = integer_value(*steps)?;
            let semitones = integer_value(*semitones)?;
            fresh(song, new_id, 70)?;
            ensure(
                song.tables.patterns.contains_key(pattern_id),
                "Unknown pattern",
            )?;
            let mut copied: std::collections::BTreeMap<String, String> =
                std::collections::BTreeMap::new();
            for event in song
                .tables
                .events
                .values()
                .filter(|e| e.pattern_id == *pattern_id)
                .cloned()
                .collect::<Vec<_>>()
            {
                if event.kind == "note"
                    && let Some(entry) = song.tables.events.get_mut(&event.id)
                {
                    entry.pitch = shift_pitch(&entry.pitch, steps, semitones)?;
                }
                if event.kind == "chord" {
                    let chord_id = event.chord_id.clone().unwrap_or_default();
                    let id = match copied.get(&chord_id) {
                        Some(id) => id.clone(),
                        None => {
                            let id = format!("{new_id}-{}", copied.len());
                            fresh(song, &id, 100)?;
                            copied.insert(chord_id.clone(), id.clone());
                            let mut chord =
                                lookup(&song.tables.chords, "chord", &chord_id)?.clone();
                            chord.id = id.clone();
                            chord.label = None;
                            chord.notes = chord
                                .notes
                                .iter()
                                .map(|n| {
                                    shift_pitch(&n.pitch, steps, semitones)
                                        .map(|pitch| crate::Note { pitch, ..n.clone() })
                                })
                                .collect::<Result<Vec<_>>>()?;
                            song.tables.chords.insert(id.clone(), chord);
                            id
                        }
                    };
                    if let Some(entry) = song.tables.events.get_mut(&event.id) {
                        entry.chord_id = Some(id);
                    }
                }
            }
        }
        HarmonyAction::VoiceLead {
            source_id,
            target_id,
            octave_radius,
        } => {
            let result = voice_leading(song, source_id, target_id, *octave_radius)?;
            if let Some(entry) = song.tables.chords.get_mut(target_id) {
                entry.notes = result.notes;
            }
        }
        HarmonyAction::Perform {
            event_id,
            order,
            step,
            duration,
        } => {
            ensure(
                *step >= Time::ZERO,
                "Use normalized nonnegative time; duration must be positive",
            )?;
            if let Some(duration) = duration {
                positive(*duration)?;
            }
            let event = lookup(&song.tables.events, "event", event_id)?.clone();
            ensure(event.kind == "chord", "Choose a chord event")?;
            let chord = lookup(
                &song.tables.chords,
                "chord",
                event.chord_id.as_deref().unwrap_or(""),
            )?;
            ensure(
                order.len() == chord.notes.len()
                    && order
                        .iter()
                        .collect::<std::collections::BTreeSet<_>>()
                        .len()
                        == chord.notes.len()
                    && order
                        .iter()
                        .all(|id| chord.notes.iter().any(|n| &n.id == id)),
                "Order must contain every chord member exactly once",
            )?;
            let mut performance = Vec::new();
            for (i, member_id) in order.iter().enumerate() {
                let prior = event.performance.iter().find(|m| &m.member_id == member_id);
                performance.push(crate::Performance {
                    member_id: member_id.clone(),
                    offset: step.checked_mul(Time::new(i as i64, 1)?)?,
                    duration: duration.unwrap_or(prior.map_or(event.duration, |m| m.duration)),
                    gain: prior.and_then(|m| m.gain),
                    articulation: prior.and_then(|m| m.articulation.clone()),
                });
            }
            if let Some(entry) = song.tables.events.get_mut(&event.id) {
                entry.performance = performance;
            }
        }
        HarmonyAction::Expression {
            event_ids,
            from,
            to,
            articulation,
            gate,
        } => {
            positive(*gate)?;
            ensure(
                !event_ids.is_empty()
                    && event_ids.len() <= 512
                    && event_ids
                        .iter()
                        .collect::<std::collections::BTreeSet<_>>()
                        .len()
                        == event_ids.len()
                    && [*from, *to]
                        .iter()
                        .all(|x| x.is_finite() && (0.0..=1.0).contains(x))
                    && ["normal", "staccato", "sustain", "muted", "ghost"]
                        .contains(&articulation.as_str()),
                "Choose 1–512 events, accents 0–1 and articulation",
            )?;
            let mut events = Vec::new();
            for id in event_ids {
                let event = lookup(&song.tables.events, "event", id)?.clone();
                ensure(
                    event.kind != "rest",
                    "Select sounding events; rests stay independent",
                )?;
                events.push(event);
            }
            events.sort_by(|a, b| a.start.cmp(&b.start).then(a.id.cmp(&b.id)));
            ensure(
                events
                    .iter()
                    .map(|e| &e.pattern_id)
                    .collect::<std::collections::BTreeSet<_>>()
                    .len()
                    == 1,
                "Choose expression events from one pattern",
            )?;
            for (i, event) in events.iter().enumerate() {
                if let Some(entry) = song.tables.events.get_mut(&event.id) {
                    entry.accent = from
                        + (to - from)
                            * (if events.len() == 1 {
                                0.0
                            } else {
                                i as f64 / (events.len() - 1) as f64
                            });
                    entry.articulation = articulation.clone();
                    entry.duration = entry.duration.checked_mul(*gate)?;
                    for perf in &mut entry.performance {
                        perf.duration = perf.duration.checked_mul(*gate)?;
                    }
                }
            }
        }
    }
    Ok(())
}
