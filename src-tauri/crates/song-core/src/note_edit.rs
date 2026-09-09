//! Note-level edits: pitch/start/duration changes, member removal and note
//! combination. Mirrors changeNotes/removeNotes/combineNotes in note-edit.ts.
//! Each helper returns generic table changes for the shared edit path.
use crate::{MusicalEvent, Note, Result, Song, Time, ensure, lookup};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct NoteTarget {
    pub event_id: String,
    pub member_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct NoteEdit {
    pub event_id: String,
    pub member_id: Option<String>,
    #[ts(type = "{ degree: number, alteration: number, octave: number } | null")]
    pub pitch: Option<crate::Pitch>,
    pub start: Option<Time>,
    pub duration: Option<Time>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct WireChange {
    pub table: String,
    pub id: String,
    #[ts(type = "unknown")]
    pub value: serde_json::Value,
}

fn ordered(events: &mut Vec<MusicalEvent>, event: MusicalEvent) {
    match events.iter_mut().find(|e| e.id == event.id) {
        Some(existing) => *existing = event,
        None => events.push(event),
    }
}

pub fn change_notes(song: &Song, edits: &[NoteEdit]) -> Result<Vec<WireChange>> {
    let mut events = Vec::new();
    let mut chords: Vec<crate::Chord> = Vec::new();
    for edit in edits {
        let original = lookup(&song.tables.events, "event", &edit.event_id)
            .map_err(|_| crate::Error::new("invalid", "The selected note no longer exists"))?;
        let mut event = events
            .iter()
            .find(|e: &&MusicalEvent| e.id == original.id)
            .cloned()
            .unwrap_or_else(|| original.clone());
        if edit.member_id.is_none() {
            ensure(event.kind == "note", "Select an individual pitched note")?;
            if let Some(pitch) = &edit.pitch {
                event.pitch = pitch.clone();
            }
            if let Some(start) = edit.start {
                event.start = start;
            }
            if let Some(duration) = edit.duration {
                event.duration = duration;
            }
        } else {
            let member_id = edit.member_id.as_deref().unwrap();
            ensure(event.kind == "chord", "The selected chord changed")?;
            let chord_id = event.chord_id.clone().unwrap_or_default();
            let mut chord = match chords.iter().find(|c| c.id == chord_id) {
                Some(cached) => cached.clone(),
                None => lookup(&song.tables.chords, "chord", &chord_id)?.clone(),
            };
            let member = chord
                .notes
                .iter_mut()
                .find(|n| n.id == member_id)
                .ok_or_else(|| crate::Error::new("invalid", "The chord member no longer exists"))?;
            if let Some(pitch) = &edit.pitch {
                member.pitch = pitch.clone();
                match chords.iter_mut().find(|c| c.id == chord.id) {
                    Some(cached) => *cached = chord.clone(),
                    None => chords.push(chord.clone()),
                }
            }
            if edit.start.is_some() || edit.duration.is_some() {
                if !event.performance.iter().any(|p| p.member_id == member_id) {
                    event.performance.push(crate::Performance {
                        member_id: member_id.into(),
                        offset: Time::ZERO,
                        duration: event.duration,
                        gain: None,
                        articulation: None,
                    });
                }
                let performance = event
                    .performance
                    .iter_mut()
                    .find(|p| p.member_id == member_id)
                    .expect("member performance just ensured");
                if let Some(start) = edit.start {
                    performance.offset = start.checked_sub(event.start)?;
                }
                if let Some(duration) = edit.duration {
                    performance.duration = duration;
                }
                // Moving one member earlier moves the event anchor and preserves
                // every other member's absolute attack and release.
                if performance.offset < Time::ZERO {
                    let shift = performance.offset;
                    for note in &chord.notes {
                        if !event.performance.iter().any(|p| p.member_id == note.id) {
                            event.performance.push(crate::Performance {
                                member_id: note.id.clone(),
                                offset: Time::ZERO,
                                duration: event.duration,
                                gain: None,
                                articulation: None,
                            });
                        }
                    }
                    event.start = event.start.checked_add(shift)?;
                    for perf in &mut event.performance {
                        perf.offset = perf.offset.checked_sub(shift)?;
                    }
                }
            }
        }
        ordered(&mut events, event);
    }
    let mut changes: Vec<WireChange> = events
        .into_iter()
        .map(|event| WireChange {
            table: "events".into(),
            id: event.id.clone(),
            value: serde_json::to_value(event).unwrap(),
        })
        .collect();
    changes.extend(chords.into_iter().map(|chord| WireChange {
        table: "chords".into(),
        id: chord.id.clone(),
        value: serde_json::to_value(chord).unwrap(),
    }));
    Ok(changes)
}

pub fn remove_notes(song: &Song, targets: &[NoteTarget]) -> Result<Vec<WireChange>> {
    let mut deleted: Vec<String> = Vec::new();
    let mut removals: Vec<(String, Vec<String>)> = Vec::new();
    for target in targets {
        let event = lookup(&song.tables.events, "event", &target.event_id)
            .map_err(|_| crate::Error::new("invalid", "The selected event no longer exists"))?;
        match &target.member_id {
            None => {
                if !deleted.contains(&event.id) {
                    deleted.push(event.id.clone());
                }
            }
            Some(member) => {
                let chord_id = event.chord_id.clone().unwrap_or_default();
                match removals.iter_mut().find(|(id, _)| id == &chord_id) {
                    Some((_, members)) => {
                        if !members.contains(member) {
                            members.push(member.clone());
                        }
                    }
                    None => removals.push((chord_id, vec![member.clone()])),
                }
            }
        }
    }
    let mut changes: Vec<WireChange> = deleted
        .iter()
        .map(|id| WireChange {
            table: "events".into(),
            id: id.clone(),
            value: serde_json::Value::Null,
        })
        .collect();
    for (id, members) in &removals {
        let chord = lookup(&song.tables.chords, "chord", id)?.clone();
        let notes: Vec<Note> = chord
            .notes
            .into_iter()
            .filter(|n| !members.contains(&n.id))
            .collect();
        ensure(
            !notes.is_empty(),
            "A chord needs at least one member. Delete the chord event in Selection instead.",
        )?;
        changes.push(WireChange {
            table: "chords".into(),
            id: id.clone(),
            value: serde_json::to_value(crate::Chord { notes, ..chord }).unwrap(),
        });
        let mut affected: Vec<&MusicalEvent> = song
            .tables
            .events
            .values()
            .filter(|e| e.chord_id.as_deref() == Some(id.as_str()) && !deleted.contains(&e.id))
            .collect();
        affected.sort_by(|a, b| a.id.cmp(&b.id));
        for event in affected {
            changes.push(WireChange {
                table: "events".into(),
                id: event.id.clone(),
                value: serde_json::to_value(crate::MusicalEvent {
                    performance: event
                        .performance
                        .iter()
                        .filter(|p| !members.contains(&p.member_id))
                        .cloned()
                        .collect(),
                    ..event.clone()
                })
                .unwrap(),
            });
        }
    }
    Ok(changes)
}

pub fn combine_notes(
    song: &Song,
    targets: &[NoteTarget],
    chord_id: &str,
    event_id: &str,
) -> Result<Vec<WireChange>> {
    ensure(
        !targets.is_empty() && targets.iter().all(|t| t.member_id.is_none()),
        "Select individual notes to make a chord",
    )?;
    let mut seen = Vec::new();
    for target in targets {
        if !seen.contains(&target.event_id) {
            seen.push(target.event_id.clone());
        }
    }
    let mut events = Vec::new();
    for id in &seen {
        events.push(lookup(&song.tables.events, "event", id)?.clone());
    }
    ensure(
        events
            .iter()
            .all(|e| e.kind == "note" && e.pattern_id == events[0].pattern_id),
        "Choose notes from one pattern",
    )?;
    ensure(
        events
            .iter()
            .all(|e| e.accent == events[0].accent && e.articulation == events[0].articulation),
        "Choose notes with matching expression, or use Harmony to set member expression explicitly",
    )?;
    let start = events.iter().map(|e| e.start).min().unwrap_or(Time::ZERO);
    let end = events
        .iter()
        .map(|e| e.start.checked_add(e.duration))
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .max()
        .unwrap_or(start);
    let first = &events[0];
    let performance = events
        .iter()
        .map(|e| {
            Ok(crate::Performance {
                member_id: e.id.clone(),
                offset: e.start.checked_sub(start)?,
                duration: e.duration,
                gain: None,
                articulation: None,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let mut changes = vec![WireChange {
        table: "chords".into(),
        id: chord_id.into(),
        value: serde_json::to_value(crate::Chord {
            id: chord_id.into(),
            name: "Chord".into(),
            label_tonic: crate::Pitch {
                degree: 1,
                alteration: 0,
                octave: 0,
            },
            notes: events
                .iter()
                .map(|e| Note {
                    id: e.id.clone(),
                    pitch: e.pitch.clone(),
                })
                .collect(),
            label: None,
        })
        .unwrap(),
    }];
    changes.push(WireChange {
        table: "events".into(),
        id: event_id.into(),
        value: serde_json::to_value(crate::MusicalEvent {
            id: event_id.into(),
            name: "Chord".into(),
            origin_id: event_id.into(),
            pattern_id: first.pattern_id.clone(),
            kind: "chord".into(),
            start,
            duration: end.checked_sub(start)?,
            // The combined event keeps the default note pitch; members carry
            // the sounding pitches.
            pitch: crate::Pitch {
                degree: 1,
                alteration: 0,
                octave: 0,
            },
            chord_id: Some(chord_id.into()),
            drum: first.drum.clone(),
            accent: first.accent,
            articulation: first.articulation.clone(),
            performance,
        })
        .unwrap(),
    });
    for id in seen {
        changes.push(WireChange {
            table: "events".into(),
            id,
            value: serde_json::Value::Null,
        });
    }
    Ok(changes)
}
