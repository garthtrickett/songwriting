//! Mechanical section-arrangement transformations. Mirrors structureChanges in
//! structure.ts: repeat, move, remove, attach and variation. The caller chooses
//! what music to change; every result still passes song validation.
//!
//! One deliberate difference: deep-copy numbering in `variation` follows sorted
//! table order (BTreeMap) rather than insertion order, so copied IDs can differ
//! from the TypeScript reference when a table holds several entities. The
//! remapping shape is identical; variation is covered structurally, not byte
//! by byte.
use crate::{Result, Song, ensure, lookup};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum StructureAction {
    Repeat {
        appearance_id: String,
        new_id: String,
    },
    Move {
        appearance_id: String,
        direction: i32,
    },
    Remove {
        appearance_id: String,
    },
    Variation {
        appearance_id: String,
        new_id: String,
        name: String,
    },
    Attach {
        appearance_id: String,
        occurrence_id: String,
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

fn fresh(song: &Song, id: &str) -> Result<()> {
    ensure(
        crate::validate::identity(id),
        "New ID must be 1–100 letters, digits, underscores or hyphens",
    )?;
    ensure(!id_exists(song, id), &format!("ID already exists: {id}"))?;
    Ok(())
}

pub fn structure(song: &mut Song, action: &StructureAction) -> Result<()> {
    let appearance = lookup(
        &song.tables.arrangement,
        "arrangement",
        match action {
            StructureAction::Repeat { appearance_id, .. }
            | StructureAction::Move { appearance_id, .. }
            | StructureAction::Remove { appearance_id }
            | StructureAction::Variation { appearance_id, .. }
            | StructureAction::Attach { appearance_id, .. } => appearance_id,
        },
    )
    .map_err(|_| crate::Error::new("invalid", "Select an arranged section"))?
    .clone();
    let mut order = song.arrangement_order.clone();
    let index = order
        .iter()
        .position(|id| id == &appearance.id)
        .ok_or_else(|| crate::Error::new("invalid", "Select an arranged section"))?;
    match action {
        StructureAction::Repeat { new_id, .. } => {
            fresh(song, new_id)?;
            song.tables.arrangement.insert(
                new_id.clone(),
                crate::Arrangement {
                    id: new_id.clone(),
                    ..appearance
                },
            );
            order.insert(index + 1, new_id.clone());
        }
        StructureAction::Move { direction, .. } => {
            ensure(
                *direction == -1 || *direction == 1,
                "Direction must be -1 or 1",
            )?;
            let to = index as i64 + i64::from(*direction);
            ensure(
                to >= 0 && (to as usize) < order.len(),
                "Section is already at the edge",
            )?;
            order.swap(index, to as usize);
        }
        StructureAction::Remove { .. } => {
            song.tables.arrangement.remove(&appearance.id);
            order.remove(index);
        }
        StructureAction::Attach { occurrence_id, .. } => {
            let occurrence = lookup(&song.tables.occurrences, "occurrence", occurrence_id)
                .map_err(|_| crate::Error::new("invalid", "Choose a global placement to attach"))?;
            ensure(
                occurrence.section_id.is_none(),
                "Choose a global placement to attach",
            )?;
            let start = crate::section_spans(song)?
                .into_iter()
                .find(|span| span.id == appearance.id)
                .ok_or_else(|| crate::Error::new("invalid", "Select an arranged section"))?
                .start;
            ensure(
                occurrence.start >= start,
                "Placement begins before this section",
            )?;
            let mut attached = occurrence.clone();
            attached.section_id = Some(appearance.section_id.clone());
            attached.start = attached.start.checked_sub(start)?;
            song.tables
                .occurrences
                .insert(attached.id.clone(), attached);
        }
        StructureAction::Variation { new_id, name, .. } => {
            variation(song, &appearance, new_id, name)?;
            return Ok(());
        }
    }
    song.arrangement_order = order;
    Ok(())
}

struct Copier {
    new_id: String,
    next: usize,
    ids: std::collections::BTreeMap<(String, String), String>,
}

impl Copier {
    fn copied(&mut self, song: &Song, table: &str, id: &str) -> Result<String> {
        let key = (table.to_string(), id.to_string());
        if let Some(existing) = self.ids.get(&key) {
            return Ok(existing.clone());
        }
        self.next += 1;
        let next = format!("{}-{}", self.new_id, self.next);
        fresh(song, &next)?;
        self.ids.insert(key, next.clone());
        Ok(next)
    }
}

fn variation(
    song: &mut Song,
    appearance: &crate::Arrangement,
    new_id: &str,
    name: &str,
) -> Result<()> {
    fresh(song, new_id)?;
    ensure(
        new_id.len() <= 70,
        "Variation ID must be at most 70 characters",
    )?;
    let section = lookup(&song.tables.sections, "section", &appearance.section_id)?.clone();
    let mut copier = Copier {
        new_id: new_id.to_string(),
        next: 0,
        ids: std::collections::BTreeMap::new(),
    };
    let mut bars = Vec::new();
    for id in &section.bar_ids {
        let next = copier.copied(song, "bars", id)?;
        let mut bar = lookup(&song.tables.bars, "bar", id)?.clone();
        bar.id = next.clone();
        bar.section_id = new_id.to_string();
        song.tables.bars.insert(next.clone(), bar);
        bars.push(next);
    }
    song.tables.sections.insert(
        new_id.to_string(),
        crate::Section {
            id: new_id.to_string(),
            name: name.to_string(),
            source_id: Some(section.id.clone()),
            bar_ids: bars,
        },
    );
    for phrase in song
        .tables
        .phrases
        .values()
        .filter(|p| p.section_id == section.id)
        .cloned()
        .collect::<Vec<_>>()
    {
        let id = copier.copied(song, "phrases", &phrase.id)?;
        song.tables.phrases.insert(
            id.clone(),
            crate::Phrase {
                id: id.clone(),
                section_id: new_id.to_string(),
                ..phrase
            },
        );
    }
    for lyric in song
        .tables
        .lyrics
        .values()
        .filter(|l| l.section_id == section.id)
        .cloned()
        .collect::<Vec<_>>()
    {
        let id = copier.copied(song, "lyrics", &lyric.id)?;
        song.tables.lyrics.insert(
            id.clone(),
            crate::Lyric {
                id: id.clone(),
                section_id: new_id.to_string(),
                phrase_id: match &lyric.phrase_id {
                    None => None,
                    Some(target) => Some(copier.copied(song, "phrases", target)?),
                },
                ..lyric
            },
        );
    }
    let local: Vec<_> = song
        .tables
        .occurrences
        .values()
        .filter(|o| o.section_id.as_deref() == Some(section.id.as_str()))
        .cloned()
        .collect();
    let pattern_ids: std::collections::BTreeSet<String> =
        local.iter().map(|o| o.pattern_id.clone()).collect();
    let mut chord_ids = std::collections::BTreeSet::new();
    for event in song.tables.events.values() {
        if pattern_ids.contains(&event.pattern_id)
            && let Some(id) = &event.chord_id
        {
            chord_ids.insert(id.clone());
        }
    }
    for id in chord_ids {
        let next = copier.copied(song, "chords", &id)?;
        let mut chord = lookup(&song.tables.chords, "chord", &id)?.clone();
        chord.id = next.clone();
        song.tables.chords.insert(next, chord);
    }
    for id in &pattern_ids {
        let next = copier.copied(song, "patterns", id)?;
        let mut pattern = lookup(&song.tables.patterns, "pattern", id)?.clone();
        pattern.id = next.clone();
        pattern.source_id = Some(id.clone());
        song.tables.patterns.insert(next, pattern);
    }
    for event in song
        .tables
        .events
        .values()
        .filter(|e| pattern_ids.contains(&e.pattern_id))
        .cloned()
        .collect::<Vec<_>>()
    {
        // Resolve remapped references before borrowing the table mutably.
        let pattern = copier.copied(song, "patterns", &event.pattern_id)?;
        let chord = match &event.chord_id {
            None => None,
            Some(id) => Some(copier.copied(song, "chords", id)?),
        };
        let id = copier.copied(song, "events", &event.id)?;
        song.tables.events.insert(
            id.clone(),
            crate::MusicalEvent {
                id: id.clone(),
                pattern_id: pattern,
                chord_id: chord,
                ..event
            },
        );
    }
    for occurrence in &local {
        let id = copier.copied(song, "occurrences", &occurrence.id)?;
        let pattern = copier.copied(song, "patterns", &occurrence.pattern_id)?;
        song.tables.occurrences.insert(
            id.clone(),
            crate::Occurrence {
                id: id.clone(),
                section_id: Some(new_id.to_string()),
                pattern_id: pattern,
                ..occurrence.clone()
            },
        );
    }
    for (key, record) in song
        .tables
        .takes
        .iter()
        .filter(|(_, take)| take.section_id.as_deref() == Some(section.id.as_str()))
        .map(|(key, record)| (key.clone(), record.clone()))
        .collect::<Vec<_>>()
    {
        let id = copier.copied(song, "takes", &key)?;
        song.tables.takes.insert(
            id.clone(),
            crate::Take {
                id,
                section_id: Some(new_id.to_string()),
                ..record
            },
        );
    }
    let local_occurrences: std::collections::BTreeSet<&str> =
        local.iter().map(|o| o.id.as_str()).collect();
    let finger_ids: std::collections::BTreeSet<String> = song
        .tables
        .fingerings
        .values()
        .filter(|f| local_occurrences.contains(f.occurrence_id.as_str()))
        .map(|f| f.id.clone())
        .collect();
    for fingering in song
        .tables
        .fingerings
        .values()
        .filter(|f| local_occurrences.contains(f.occurrence_id.as_str()))
        .cloned()
        .collect::<Vec<_>>()
    {
        let id = copier.copied(song, "fingerings", &fingering.id)?;
        let occurrence = copier.copied(song, "occurrences", &fingering.occurrence_id)?;
        let event = match song.tables.events.get(&fingering.event_id) {
            Some(e) if pattern_ids.contains(&e.pattern_id) => {
                copier.copied(song, "events", &fingering.event_id)?
            }
            _ => fingering.event_id.clone(),
        };
        let from = match &fingering.from_id {
            Some(target) if finger_ids.contains(target) => {
                Some(copier.copied(song, "fingerings", target)?)
            }
            _ => fingering.from_id.clone(),
        };
        song.tables.fingerings.insert(
            id.clone(),
            crate::Fingering {
                id: id.clone(),
                occurrence_id: occurrence,
                event_id: event,
                from_id: from,
                ..fingering
            },
        );
    }
    for region in song
        .tables
        .harmony
        .values()
        .filter(|h| h.section_id.as_deref() == Some(section.id.as_str()))
        .cloned()
        .collect::<Vec<_>>()
    {
        let id = copier.copied(song, "harmony", &region.id)?;
        song.tables.harmony.insert(
            id.clone(),
            crate::HarmonicRegion {
                id: id.clone(),
                section_id: Some(new_id.to_string()),
                ..region
            },
        );
    }
    for poly in song
        .tables
        .polyrhythms
        .values()
        .filter(|p| p.section_id.as_deref() == Some(section.id.as_str()))
        .cloned()
        .collect::<Vec<_>>()
    {
        let id = copier.copied(song, "polyrhythms", &poly.id)?;
        let mut lanes = Vec::new();
        for lane in &poly.lanes {
            lanes.push(crate::PolyrhythmLane {
                occurrence_id: copier.copied(song, "occurrences", &lane.occurrence_id)?,
                ..lane.clone()
            });
        }
        song.tables.polyrhythms.insert(
            id.clone(),
            crate::Polyrhythm {
                id: id.clone(),
                section_id: Some(new_id.to_string()),
                lanes,
                ..poly
            },
        );
    }
    if let Some(entry) = song.tables.arrangement.get_mut(&appearance.id) {
        entry.name = name.to_string();
        entry.section_id = new_id.to_string();
    }
    Ok(())
}
