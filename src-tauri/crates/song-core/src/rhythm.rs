//! Rhythm transformations: pattern variation, occurrence displacement and
//! phase, rotation, accent rotation, scaling, splicing and polyrhythm
//! construction. Mirrors rhythmChanges in rhythm.ts.
//!
//! Event enumeration follows the reference ascending (start, id) order so
//! generated IDs match; multi-entity map order is otherwise canonicalized.
use crate::{Result, Song, Time, ensure, lookup};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct RhythmLane {
    pub voice_id: String,
    pub divisions: i32,
    #[ts(type = "{ degree: number, alteration: number, octave: number }")]
    pub pitch: crate::Pitch,
    pub drum: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RhythmAction {
    Variation {
        pattern_id: String,
        new_id: String,
        name: String,
    },
    Displace {
        occurrence_id: String,
        amount: Time,
    },
    Phase {
        occurrence_id: String,
        amount: Time,
    },
    Rotate {
        pattern_id: String,
        amount: Time,
    },
    Accents {
        pattern_id: String,
        steps: f64,
    },
    Scale {
        pattern_id: String,
        factor: Time,
        releases: String,
        phases: String,
    },
    Splice {
        pattern_id: String,
        at: Time,
        amount: Time,
        mode: String,
        attacks: String,
        phases: String,
    },
    Polyrhythm {
        new_id: String,
        name: String,
        section_id: Option<String>,
        start: Time,
        duration: Time,
        note_duration: Time,
        lanes: Vec<RhythmLane>,
    },
}

fn id_exists(song: &Song, id: &str) -> bool {
    let t = &song.tables;
    t.patterns.contains_key(id)
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
        || t.takes.contains_key(id)
}

fn fresh(song: &Song, id: &str) -> Result<String> {
    ensure(crate::validate::identity(id), "Invalid new ID")?;
    ensure(!id_exists(song, id), &format!("ID already exists: {id}"))?;
    Ok(id.to_string())
}

fn positive(time: Time) -> Result<()> {
    ensure(
        time > Time::ZERO,
        "Use normalized time; durations and factors must be positive",
    )
}

fn pattern_events(song: &Song, pattern_id: &str) -> Vec<crate::MusicalEvent> {
    let mut events: Vec<_> = song
        .tables
        .events
        .values()
        .filter(|e| e.pattern_id == pattern_id)
        .cloned()
        .collect();
    events.sort_by(|a, b| a.start.cmp(&b.start).then(a.id.cmp(&b.id)));
    events
}

pub fn rhythm(song: &mut Song, action: &RhythmAction) -> Result<()> {
    if let RhythmAction::Polyrhythm { new_id, .. } | RhythmAction::Variation { new_id, .. } = action
    {
        fresh(song, new_id)?;
        ensure(new_id.len() <= 70, "New ID must be at most 70 characters")?;
    }
    match action {
        RhythmAction::Polyrhythm {
            new_id,
            name,
            section_id,
            start,
            duration,
            note_duration,
            lanes,
        } => {
            ensure((2..=8).contains(&lanes.len()), "Choose 2–8 voices")?;
            positive(*duration)?;
            positive(*note_duration)?;
            let mut lane_refs = Vec::new();
            for (i, lane) in lanes.iter().enumerate() {
                let voice = lookup(&song.tables.voices, "voice", &lane.voice_id)
                    .map_err(|_| crate::Error::new("invalid", "Unknown voice"))?
                    .clone();
                let part = lookup(&song.tables.parts, "part", &voice.part_id)?.clone();
                ensure((1..=64).contains(&lane.divisions), "Divisions must be 1–64")?;
                let pattern_id = fresh(song, &format!("{new_id}-p{i}"))?;
                let occurrence_id = fresh(song, &format!("{new_id}-o{i}"))?;
                let step = duration.checked_mul(Time::new(1, i64::from(lane.divisions))?)?;
                song.tables.patterns.insert(
                    pattern_id.clone(),
                    crate::Pattern {
                        id: pattern_id.clone(),
                        name: format!("{name} · {}", lane.divisions),
                        groups: vec![step; lane.divisions as usize],
                        length: *duration,
                        source_id: None,
                    },
                );
                for j in 0..lane.divisions {
                    let id = fresh(song, &format!("{new_id}-e{i}-{j}"))?;
                    song.tables.events.insert(
                        id.clone(),
                        crate::MusicalEvent {
                            id: id.clone(),
                            name: format!("Pulse {}", j + 1),
                            origin_id: id.clone(),
                            pattern_id: pattern_id.clone(),
                            kind: if part.instrument == "drums" {
                                "drum".into()
                            } else {
                                "note".into()
                            },
                            start: step.checked_mul(Time::new(i64::from(j), 1)?)?,
                            duration: *note_duration,
                            pitch: lane.pitch.clone(),
                            chord_id: None,
                            drum: lane.drum.clone(),
                            accent: 0.7,
                            articulation: "normal".into(),
                            performance: vec![],
                        },
                    );
                }
                song.tables.occurrences.insert(
                    occurrence_id.clone(),
                    crate::Occurrence {
                        id: occurrence_id.clone(),
                        name: format!("{name} · {}", voice.name),
                        section_id: section_id.clone(),
                        pattern_id: pattern_id.clone(),
                        voice_id: lane.voice_id.clone(),
                        start: *start,
                        span: *duration,
                        phase: Time::ZERO,
                        boundary: "continue".into(),
                        tails: "ring".into(),
                    },
                );
                lane_refs.push((occurrence_id, lane.divisions));
            }
            song.tables.polyrhythms.insert(
                new_id.clone(),
                crate::Polyrhythm {
                    id: new_id.clone(),
                    name: name.clone(),
                    section_id: section_id.clone(),
                    start: *start,
                    duration: *duration,
                    lanes: lane_refs
                        .into_iter()
                        .map(|(occurrence_id, divisions)| crate::PolyrhythmLane {
                            occurrence_id,
                            divisions,
                        })
                        .collect(),
                },
            );
        }
        RhythmAction::Displace {
            occurrence_id,
            amount,
        }
        | RhythmAction::Phase {
            occurrence_id,
            amount,
        } => {
            let mut occurrence = lookup(&song.tables.occurrences, "occurrence", occurrence_id)
                .map_err(|_| crate::Error::new("invalid", "Unknown occurrence"))?
                .clone();
            if matches!(action, RhythmAction::Displace { .. }) {
                occurrence.start = occurrence.start.checked_add(*amount)?;
            } else {
                let length =
                    lookup(&song.tables.patterns, "pattern", &occurrence.pattern_id)?.length;
                occurrence.phase = occurrence
                    .phase
                    .checked_add(*amount)?
                    .checked_modulo(length)?;
            }
            song.tables
                .occurrences
                .insert(occurrence.id.clone(), occurrence);
        }
        _ => {
            let pattern_id = match action {
                RhythmAction::Variation { pattern_id, .. }
                | RhythmAction::Rotate { pattern_id, .. }
                | RhythmAction::Accents { pattern_id, .. }
                | RhythmAction::Scale { pattern_id, .. }
                | RhythmAction::Splice { pattern_id, .. } => pattern_id,
                _ => unreachable!(),
            };
            let pattern = lookup(&song.tables.patterns, "pattern", pattern_id)
                .map_err(|_| crate::Error::new("invalid", "Unknown pattern"))?
                .clone();
            let events = pattern_events(song, &pattern.id);
            match action {
                RhythmAction::Variation { new_id, name, .. } => {
                    let mut chord_ids = std::collections::BTreeMap::new();
                    for event in &events {
                        if let Some(chord) = &event.chord_id
                            && !chord_ids.contains_key(chord)
                        {
                            let id = fresh(song, &format!("{new_id}-c{}", chord_ids.len()))?;
                            chord_ids.insert(chord.clone(), id.clone());
                            let mut entry = lookup(&song.tables.chords, "chord", chord)?.clone();
                            entry.id = id.clone();
                            song.tables.chords.insert(id, entry);
                        }
                    }
                    song.tables.patterns.insert(
                        new_id.clone(),
                        crate::Pattern {
                            id: new_id.clone(),
                            name: name.clone(),
                            source_id: Some(pattern.id.clone()),
                            ..pattern
                        },
                    );
                    for (i, event) in events.iter().enumerate() {
                        let id = fresh(song, &format!("{new_id}-e{i}"))?;
                        song.tables.events.insert(
                            id.clone(),
                            crate::MusicalEvent {
                                id: id.clone(),
                                pattern_id: new_id.clone(),
                                chord_id: event.chord_id.as_ref().map(|c| chord_ids[c].clone()),
                                ..event.clone()
                            },
                        );
                    }
                }
                RhythmAction::Accents { steps, .. } => {
                    ensure(
                        steps.fract() == 0.0 && steps.abs() <= crate::MAX_SAFE_INTEGER as f64,
                        "Accent rotation needs whole steps",
                    )?;
                    let played: Vec<_> = events.iter().filter(|e| e.kind != "rest").collect();
                    ensure(
                        !played.is_empty(),
                        "Pattern has no sounded events to accent",
                    )?;
                    let n = played.len() as i64;
                    let steps = *steps as i64;
                    for (i, event) in played.iter().enumerate() {
                        let source =
                            played[(((i as i64 - (steps % n)) % n + n) % n) as usize].accent;
                        if let Some(entry) = song.tables.events.get_mut(&event.id) {
                            entry.accent = source;
                        }
                    }
                }
                RhythmAction::Rotate { amount, .. } => {
                    for event in &events {
                        if let Some(entry) = song.tables.events.get_mut(&event.id) {
                            entry.start = event
                                .start
                                .checked_add(*amount)?
                                .checked_modulo(pattern.length)?;
                        }
                    }
                }
                RhythmAction::Scale {
                    factor,
                    releases,
                    phases,
                    ..
                } => {
                    positive(*factor)?;
                    ensure(
                        ["scale", "preserve"].contains(&releases.as_str())
                            && ["follow", "keep"].contains(&phases.as_str()),
                        "Choose release and phase policies",
                    )?;
                    let scaled = |t: Time| t.checked_mul(*factor);
                    let release = |t: Time| -> Result<Time> {
                        if releases == "scale" {
                            scaled(t)
                        } else {
                            Ok(t)
                        }
                    };
                    if let Some(entry) = song.tables.patterns.get_mut(&pattern.id) {
                        entry.length = scaled(entry.length)?;
                        entry.groups = entry
                            .groups
                            .iter()
                            .map(|g| scaled(*g))
                            .collect::<Result<Vec<_>>>()?;
                    }
                    for event in &events {
                        if let Some(entry) = song.tables.events.get_mut(&event.id) {
                            entry.start = scaled(entry.start)?;
                            entry.duration = release(entry.duration)?;
                            for perf in &mut entry.performance {
                                perf.offset = scaled(perf.offset)?;
                                perf.duration = release(perf.duration)?;
                            }
                        }
                    }
                    if phases == "follow" {
                        for occurrence in song
                            .tables
                            .occurrences
                            .values_mut()
                            .filter(|o| o.pattern_id == pattern.id)
                        {
                            occurrence.phase = scaled(occurrence.phase)?;
                        }
                    }
                }
                RhythmAction::Splice {
                    at,
                    amount,
                    mode,
                    attacks,
                    phases,
                    ..
                } => {
                    ensure(
                        ["insert", "remove"].contains(&mode.as_str())
                            && ["reject", "delete"].contains(&attacks.as_str())
                            && ["follow", "keep"].contains(&phases.as_str()),
                        "Choose splice policies",
                    )?;
                    positive(*amount)?;
                    ensure(
                        *at >= Time::ZERO && *at <= pattern.length,
                        "Splice position outside pattern",
                    )?;
                    let end = at.checked_add(*amount)?;
                    let removing = mode == "remove";
                    if removing {
                        ensure(end <= pattern.length, "Cut extends past cycle")?;
                    }
                    let length = if removing {
                        pattern.length.checked_sub(*amount)?
                    } else {
                        pattern.length.checked_add(*amount)?
                    };
                    ensure(length > Time::ZERO, "Cycle must remain positive")?;
                    let inside = |t: Time| t >= *at && t < end;
                    let mapped = |t: Time| {
                        if t < *at {
                            Ok(t)
                        } else if !removing {
                            t.checked_add(*amount)
                        } else if t >= end {
                            t.checked_sub(*amount)
                        } else {
                            Ok(*at)
                        }
                    };
                    let mut group_start = Time::ZERO;
                    let mut groups = Vec::new();
                    for (i, group) in pattern.groups.iter().enumerate() {
                        let group_end = group_start.checked_add(*group)?;
                        let mut next = *group;
                        if !removing
                            && at >= &group_start
                            && (at < &group_end
                                || (i == pattern.groups.len() - 1 && at == &group_end))
                        {
                            next = group.checked_add(*amount)?;
                        }
                        if removing {
                            let lo = if group_start > *at { group_start } else { *at };
                            let hi = if group_end < end { group_end } else { end };
                            if hi > lo {
                                next = group.checked_sub(hi.checked_sub(lo)?)?;
                            }
                        }
                        if next > Time::ZERO {
                            groups.push(next);
                        }
                        group_start = group_end;
                    }
                    if let Some(entry) = song.tables.patterns.get_mut(&pattern.id) {
                        entry.length = length;
                        entry.groups = groups;
                    }
                    for event in &events {
                        if removing && inside(event.start) {
                            if attacks == "reject" {
                                return Err(crate::Error::new(
                                    "invalid",
                                    format!(
                                        "Cut contains {}; choose delete attacks or another span",
                                        event.name
                                    ),
                                ));
                            }
                            song.tables.events.remove(&event.id);
                            continue;
                        }
                        let start = mapped(event.start)?;
                        let mut performance = Vec::new();
                        for member in &event.performance {
                            let attack = event.start.checked_add(member.offset)?;
                            if removing && inside(attack) {
                                return Err(crate::Error::new(
                                    "invalid",
                                    format!(
                                        "Cut contains a chord-member attack in {}; adjust its performance explicitly",
                                        event.name
                                    ),
                                ));
                            }
                            performance.push(crate::Performance {
                                offset: mapped(attack)?.checked_sub(start)?,
                                ..member.clone()
                            });
                        }
                        if let Some(entry) = song.tables.events.get_mut(&event.id) {
                            entry.start = start;
                            entry.performance = performance;
                        }
                    }
                    if phases == "follow" {
                        for occurrence in song
                            .tables
                            .occurrences
                            .values_mut()
                            .filter(|o| o.pattern_id == pattern.id)
                        {
                            occurrence.phase = mapped(occurrence.phase)?.checked_modulo(length)?;
                        }
                    }
                }
                _ => {
                    return Err(crate::Error::new("invalid", "Unknown rhythm action"));
                }
            }
        }
    }
    Ok(())
}
