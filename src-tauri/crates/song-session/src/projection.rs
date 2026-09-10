use crate::protocol::*;
use song_core::{Envelope, Pitch, Result, Song, Time};

fn label(p: &Pitch) -> String {
    format!(
        "{}{}{}",
        if p.alteration < 0 {
            "♭".repeat((-p.alteration) as usize)
        } else {
            "♯".repeat(p.alteration as usize)
        },
        p.degree,
        if p.octave == 0 {
            String::new()
        } else if p.octave > 0 {
            format!("↑{}", p.octave)
        } else {
            format!("↓{}", -p.octave)
        }
    )
}

/// View projection failures are visible separately from a successfully committed
/// edit. The authoritative title/revision/undo remain available for recovery.
pub fn snapshot(envelope: &Envelope, epoch: &str, profile: &str) -> Snapshot {
    let state = envelope.state();
    let Some(song) = envelope.song.clone() else {
        return Snapshot {
            protocol: PROTOCOL,
            epoch: epoch.into(),
            profile: profile.into(),
            revision: envelope.revision,
            title: String::new(),
            patterns: vec![],
            notes: vec![],
            bars: vec![],
            placements: vec![],
            warning: Some(
                "This song was deleted. Undo the deletion or import a song to continue.".into(),
            ),
            undoable: state
                .undoable
                .iter()
                .filter_map(|id| envelope.history.iter().find(|r| &r.operation_id == id))
                .map(|r| UndoView {
                    operation_id: r.operation_id.clone(),
                    label: r.mutation.label.clone(),
                })
                .collect(),
        };
    };
    let mut out = Snapshot {
        protocol: PROTOCOL,
        epoch: epoch.into(),
        profile: profile.into(),
        revision: envelope.revision,
        title: song.title.clone(),
        patterns: song
            .tables
            .patterns
            .values()
            .map(|p| PatternView {
                id: p.id.clone(),
                name: p.name.clone(),
                length: p.length,
            })
            .collect(),
        notes: vec![],
        bars: vec![],
        placements: vec![],
        warning: None,
        undoable: state
            .undoable
            .iter()
            .filter_map(|id| envelope.history.iter().find(|r| &r.operation_id == id))
            .map(|r| UndoView {
                operation_id: r.operation_id.clone(),
                label: r.mutation.label.clone(),
            })
            .collect(),
    };
    if let Err(error) = project(&song, &mut out) {
        out.notes.clear();
        out.bars.clear();
        out.placements.clear();
        out.warning = Some(format!(
            "The edit is saved, but its arrangement cannot be displayed: {error}. You can undo the edit."
        ));
    }
    out
}

fn project(song: &Song, out: &mut Snapshot) -> Result<()> {
    for event in song.tables.events.values() {
        if event.kind == "note" {
            out.notes.push(NoteView {
                event_id: event.id.clone(),
                member_id: None,
                pattern_id: event.pattern_id.clone(),
                label: label(&event.pitch),
                row: event.pitch.octave * 7 + event.pitch.degree - 1,
                start: event.start,
                duration: event.duration,
            });
        } else if let Some(chord) = event
            .chord_id
            .as_ref()
            .and_then(|id| song.tables.chords.get(id))
        {
            for note in &chord.notes {
                let performance = event.performance.iter().find(|p| p.member_id == note.id);
                out.notes.push(NoteView {
                    event_id: event.id.clone(),
                    member_id: Some(note.id.clone()),
                    pattern_id: event.pattern_id.clone(),
                    label: label(&note.pitch),
                    row: note.pitch.octave * 7 + note.pitch.degree - 1,
                    start: event
                        .start
                        .checked_add(performance.map_or(Time::ZERO, |p| p.offset))?,
                    duration: performance.map_or(event.duration, |p| p.duration),
                });
            }
        }
    }
    let mut at = Time::ZERO;
    for appearance in &song.arrangement_order {
        let section = &song.tables.sections[&song.tables.arrangement[appearance].section_id];
        for occurrence in song
            .tables
            .occurrences
            .values()
            .filter(|o| o.section_id.as_ref() == Some(&section.id))
        {
            out.placements.push(PlacementView {
                id: format!("{appearance}/{}", occurrence.id),
                name: occurrence.name.clone(),
                voice: song.tables.voices[&occurrence.voice_id].name.clone(),
                pattern_id: occurrence.pattern_id.clone(),
                start: at.checked_add(occurrence.start)?,
                duration: occurrence.span,
            });
        }
        for id in &section.bar_ids {
            let bar = &song.tables.bars[id];
            let duration = bar.actual.unwrap_or(Time::new(
                i64::from(bar.numerator) * 4,
                i64::from(bar.denominator),
            )?);
            out.bars.push(BarView {
                label: format!("{}/{}", bar.numerator, bar.denominator),
                section: section.name.clone(),
                groups: bar.groups.clone(),
                start: at,
                duration,
            });
            at = at.checked_add(duration)?;
        }
    }
    for occurrence in song
        .tables
        .occurrences
        .values()
        .filter(|o| o.section_id.is_none())
    {
        out.placements.push(PlacementView {
            id: occurrence.id.clone(),
            name: occurrence.name.clone(),
            voice: song.tables.voices[&occurrence.voice_id].name.clone(),
            pattern_id: occurrence.pattern_id.clone(),
            start: occurrence.start,
            duration: occurrence.span,
        });
    }
    Ok(())
}
