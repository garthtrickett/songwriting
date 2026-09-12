use crate::protocol::*;
use song_core::{Envelope, Result, Song, Time, pitch_label};

/// View projection failures are visible separately from a successfully committed
/// edit. The authoritative title/revision/undo remain available for recovery.
pub fn snapshot(envelope: &Envelope, epoch: &str, profile: &str) -> Snapshot {
    let state = envelope.state();
    let views = |ids: &[String]| {
        ids.iter()
            .filter_map(|id| envelope.history.iter().find(|r| &r.operation_id == id))
            .map(|r| UndoView {
                operation_id: r.operation_id.clone(),
                label: r.mutation.label.clone(),
            })
            .collect::<Vec<_>>()
    };
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
            library: Library::default(),
            warning: Some(
                "This song was deleted. Undo the deletion or import a song to continue.".into(),
            ),
            undoable: views(&state.undoable),
            redoable: views(&state.redoable),
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
        library: Library::default(),
        warning: None,
        undoable: views(&state.undoable),
        redoable: views(&state.redoable),
    };
    if let Err(error) = project(&song, &mut out) {
        out.notes.clear();
        out.bars.clear();
        out.placements.clear();
        out.library = Library::default();
        out.warning = Some(format!(
            "The edit is saved, but its arrangement cannot be displayed: {error}. You can undo the edit."
        ));
    }
    out
}

fn project(song: &Song, out: &mut Snapshot) -> Result<()> {
    out.library = library(song)?;
    for event in song.tables.events.values() {
        if event.kind == "note" {
            out.notes.push(NoteView {
                event_id: event.id.clone(),
                member_id: None,
                pattern_id: event.pattern_id.clone(),
                label: pitch_label(&event.pitch),
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
                    label: pitch_label(&note.pitch),
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

/// Table views the workbench panels read. Names are resolved here so the view
/// never joins tables itself, and every row stays traceable to accepted state.
fn library(song: &Song) -> Result<Library> {
    let section_name = |id: &str| song.tables.sections.get(id).map(|s| s.name.clone());
    let spans = song_core::section_spans(song)?;
    let mut out = Library {
        writing: WritingView {
            instructions: song.writing.instructions.clone(),
            preferences: song.writing.preferences.clone(),
            mode: song.mode.clone(),
            degree_reference: song.degree_reference.clone(),
            bpm: song.tempo.bpm,
            beat_unit: song.tempo.beat_unit,
        },
        ..Library::default()
    };
    for span in &spans {
        let appearance = &song.tables.arrangement[&span.id];
        let section = &song.tables.sections[&span.section_id];
        out.appearances.push(AppearanceView {
            id: span.id.clone(),
            name: appearance.name.clone(),
            section_id: span.section_id.clone(),
            section: section.name.clone(),
            bars: section.bar_ids.len(),
            start: span.start,
            length: span.length,
        });
    }
    out.markers = song
        .tables
        .markers
        .values()
        .map(|m| MarkerView {
            id: m.id.clone(),
            name: m.name.clone(),
            at: m.at,
        })
        .collect();
    out.annotations = song_core::annotations(song)?
        .into_iter()
        .map(|a| AnnotationView {
            table: a.table,
            id: a.id,
            name: a.name,
            start: a.start,
            duration: a.duration,
            appearance_id: a.appearance_id,
        })
        .collect();
    out.harmony = song
        .tables
        .harmony
        .values()
        .map(|r| HarmonyRegionView {
            id: r.id.clone(),
            name: r.name.clone(),
            section_id: r.section_id.clone(),
            section: r.section_id.as_deref().and_then(section_name),
            start: r.start,
            duration: r.duration,
            tonic: pitch_label(&r.tonic),
            mode: r.mode.clone(),
            annotation: r.annotation.clone(),
        })
        .collect();
    out.parts = song
        .tables
        .parts
        .values()
        .map(|part| PartView {
            id: part.id.clone(),
            name: part.name.clone(),
            instrument: part.instrument.clone(),
            volume: part.volume,
            muted: part.muted,
            voices: song
                .tables
                .voices
                .values()
                .filter(|v| v.part_id == part.id)
                .count(),
        })
        .collect();
    out.voices = song
        .tables
        .voices
        .values()
        .map(|v| VoiceView {
            id: v.id.clone(),
            name: v.name.clone(),
            part_id: v.part_id.clone(),
            part: song
                .tables
                .parts
                .get(&v.part_id)
                .map_or_else(String::new, |p| p.name.clone()),
        })
        .collect();
    out.chords = song
        .tables
        .chords
        .values()
        .map(|c| ChordView {
            id: c.id.clone(),
            name: c.name.clone(),
            label: c.label.clone(),
            tonic: pitch_label(&c.label_tonic),
            notes: c.notes.iter().map(|n| pitch_label(&n.pitch)).collect(),
        })
        .collect();
    out.polyrhythms = song
        .tables
        .polyrhythms
        .values()
        .map(|p| PolyrhythmView {
            id: p.id.clone(),
            name: p.name.clone(),
            section_id: p.section_id.clone(),
            section: p.section_id.as_deref().and_then(section_name),
            start: p.start,
            duration: p.duration,
            lanes: p
                .lanes
                .iter()
                .map(|lane| PolyrhythmLaneView {
                    occurrence_id: lane.occurrence_id.clone(),
                    occurrence: song
                        .tables
                        .occurrences
                        .get(&lane.occurrence_id)
                        .map_or_else(String::new, |o| o.name.clone()),
                    divisions: lane.divisions,
                })
                .collect(),
        })
        .collect();
    out.fretted = song
        .tables
        .fretted
        .values()
        .map(|f| FrettedView {
            id: f.id.clone(),
            name: f.name.clone(),
            part_id: f.part_id.clone(),
            part: song
                .tables
                .parts
                .get(&f.part_id)
                .map_or_else(String::new, |p| p.name.clone()),
            tonic: f.tonic,
            tuning: f.tuning.clone(),
            capo: f.capo,
            max_fret: f.max_fret,
            hand_span: f.hand_span,
            fingerings: song.tables.fingerings.len(),
        })
        .collect();
    out.takes = song_core::take_placements(song)?
        .into_iter()
        .map(|t| TakeView {
            asset: song.tables.assets.get(&t.asset_id).map(|a| a.name.clone()),
            part: song.tables.parts.get(&t.part_id).map(|p| p.name.clone()),
            section: t.section_id.as_deref().and_then(section_name),
            appearance_id: t.appearance_id,
            id: t.id,
            name: t.name,
            asset_id: t.asset_id,
            part_id: t.part_id,
            start: t.start,
            at: t.at,
            offset: t.offset,
            duration: t.duration,
            gain: t.gain,
            muted: t.muted,
        })
        .collect();
    out.lyrics = song
        .tables
        .lyrics
        .values()
        .map(|l| LyricView {
            id: l.id.clone(),
            name: l.name.clone(),
            section_id: l.section_id.clone(),
            section: section_name(&l.section_id),
            start: l.start,
            duration: l.duration,
            text: l.text.clone(),
            phrase_id: l.phrase_id.clone(),
            part_id: l.part_id.clone(),
        })
        .collect();
    out.phrases = song
        .tables
        .phrases
        .values()
        .map(|p| PhraseView {
            id: p.id.clone(),
            name: p.name.clone(),
            section_id: p.section_id.clone(),
            section: section_name(&p.section_id),
            start: p.start,
            duration: p.duration,
        })
        .collect();
    out.prompts = song
        .tables
        .prompts
        .values()
        .map(|p| PromptView {
            id: p.id.clone(),
            name: p.name.clone(),
            text: p.text.clone(),
        })
        .collect();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn case(name: &str) -> Song {
        let cases: serde_json::Value =
            serde_json::from_str(include_str!("../../../../tests/desktop/analysis.json")).unwrap();
        let case = cases
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == name)
            .unwrap_or_else(|| panic!("fixture case {name} missing"));
        serde_json::from_value(case["song"].clone()).unwrap()
    }

    /// Each table the workbench panels read must reach the view. A panel that
    /// renders an empty list because its table was never projected looks the
    /// same as a song that genuinely has none, so assert the counts.
    #[test]
    fn library_projects_every_arranged_table() {
        let song = case("analysis");
        let out = library(&song).unwrap();
        assert_eq!(out.harmony.len(), 3, "harmonic regions");
        assert_eq!(out.parts.len(), 2, "parts");
        assert_eq!(out.voices.len(), 2, "voices");
        assert_eq!(out.chords.len(), 1, "chords");
        assert_eq!(out.phrases.len(), 1, "phrases");
        assert_eq!(out.lyrics.len(), 1, "lyrics");
        assert_eq!(out.polyrhythms.len(), 1, "polyrhythms");
        assert_eq!(out.appearances.len(), 1, "appearances");
        assert_eq!(out.annotations.len(), 2, "phrase and lyric annotations");
        assert_eq!(out.writing.mode, song.mode);
        assert_eq!(out.writing.bpm, song.tempo.bpm);
    }

    #[test]
    fn library_projects_takes_and_fretted_instruments() {
        let song = case("tabtakes");
        let out = library(&song).unwrap();
        assert_eq!(out.takes.len(), 2, "take placements");
        assert_eq!(out.fretted.len(), 1, "fretted instruments");
        assert_eq!(out.fretted[0].fingerings, 2, "fingerings");
        assert!(
            out.takes.iter().all(|t| t.asset.is_none()),
            "this fixture has no asset rows, so the join must stay absent rather than invent a name"
        );
    }

    /// Names are resolved in the projection so the view never joins tables.
    #[test]
    fn library_resolves_names_through_their_foreign_keys() {
        let song = case("analysis");
        let out = library(&song).unwrap();
        for voice in &out.voices {
            assert_eq!(
                voice.part, song.tables.parts[&voice.part_id].name,
                "voice {} part name",
                voice.id
            );
        }
        for lane in out.polyrhythms.iter().flat_map(|p| &p.lanes) {
            assert_eq!(
                lane.occurrence, song.tables.occurrences[&lane.occurrence_id].name,
                "polyrhythm lane occurrence name"
            );
        }
    }

    /// A deleted song has no tables to project; the view must still receive an
    /// empty library rather than the previous song's rows.
    #[test]
    fn deleted_song_clears_the_library() {
        let envelope = song_core::Envelope::fixture(case("analysis")).unwrap();
        let full = snapshot(&envelope, "epoch", "default");
        assert!(!full.library.harmony.is_empty());
        let mut emptied = envelope.clone();
        emptied.song = None;
        let out = snapshot(&emptied, "epoch", "default");
        assert!(out.library.harmony.is_empty(), "stale harmony survived");
        assert!(out.library.parts.is_empty(), "stale parts survived");
        assert!(out.warning.is_some(), "deletion must be reported");
    }

    /// D6 tripwire, not a benchmark: the library is projected on every accepted
    /// edit, so a hundred-fold regression here stalls the whole window. The budget
    /// sits ~50x above the droplet debug-build measurement (~19ms), matching the
    /// margin used by the song-core budgets.
    /// A budget failure is investigated as a regression, never tuned to fit.
    ///
    /// `stress_song` clears sections and arrangement, so it cannot exercise the
    /// arranged expansion this projection added. The reference song carries the
    /// structure but no phrases or lyrics, so annotate every section here: the
    /// heaviest call in `library` is `annotations`, and a budget it never runs
    /// would pass no matter how slow the projection got.
    #[test]
    fn library_projects_an_annotated_reference_song_within_budget() {
        let mut song = song_testkit::reference_song();
        assert_eq!(song.tables.sections.len(), 32, "reference structure moved");
        let quarter = Time::new(1, 1).unwrap();
        for s in 0..32 {
            let section = format!("s{s:02}");
            for n in 0..32 {
                let id = format!("{section}-ph{n:02}");
                song.tables.phrases.insert(
                    id.clone(),
                    song_core::Phrase {
                        id,
                        name: format!("Phrase {n}"),
                        section_id: section.clone(),
                        start: quarter,
                        duration: quarter,
                    },
                );
                let id = format!("{section}-ly{n:02}");
                song.tables.lyrics.insert(
                    id.clone(),
                    song_core::Lyric {
                        id,
                        name: format!("Lyric {n}"),
                        section_id: section.clone(),
                        start: quarter,
                        duration: quarter,
                        text: "sing".into(),
                        phrase_id: None,
                        part_id: None,
                    },
                );
            }
        }
        let start = Instant::now();
        let out = library(&song).unwrap();
        let ms = start.elapsed().as_millis();
        eprintln!("perf reference-library: {ms}ms");
        assert_eq!(out.appearances.len(), 32, "appearances");
        assert_eq!(
            out.annotations.len(),
            2048,
            "arranged phrase and lyric rows"
        );
        assert!(ms < 1_000, "library projection budget");
    }
}
