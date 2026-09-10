//! Deterministic reference and stress songs for performance budgets.
//! Generated in-test (never checked in as blobs); every song validates.
use song_core::*;

fn time(n: i64, d: i64) -> Time {
    Time::new(n, d).unwrap()
}

/// 32 parts, 1,024 mixed-meter bars in 32 sections, 64 patterns and just over
/// 10,000 note events with section-bound occurrences.
pub fn reference_song() -> Song {
    let instruments = ["guitar", "bass", "drums", "voice"];
    let meters = [
        (7, 8, vec![2, 2, 3]),
        (5, 4, vec![3, 2]),
        (4, 4, vec![2, 2]),
        (3, 4, vec![2, 1]),
    ];
    let mut song = Song {
        schema_version: 7,
        id: "reference".into(),
        title: "Reference project".into(),
        mode: "major".into(),
        degree_reference: "major".into(),
        writing: Writing {
            instructions: String::new(),
            preferences: String::new(),
        },
        tempo: Tempo {
            bpm: 112.0,
            beat_unit: time(1, 1),
        },
        arrangement_order: vec![],
        tables: Tables {
            patterns: Default::default(),
            events: Default::default(),
            chords: Default::default(),
            bars: Default::default(),
            sections: Default::default(),
            arrangement: Default::default(),
            parts: Default::default(),
            voices: Default::default(),
            occurrences: Default::default(),
            prompts: Default::default(),
            assets: Default::default(),
            takes: Default::default(),
            fretted: Default::default(),
            fingerings: Default::default(),
            harmony: Default::default(),
            markers: Default::default(),
            phrases: Default::default(),
            lyrics: Default::default(),
            polyrhythms: Default::default(),
        },
    };
    for (i, instrument) in instruments.iter().cycle().take(32).enumerate() {
        let part = format!("p{i:02}");
        song.tables.parts.insert(
            part.clone(),
            Part {
                id: part.clone(),
                name: format!("Part {i}"),
                instrument: instrument.to_string(),
                volume: 0.8,
                muted: false,
            },
        );
        song.tables.voices.insert(
            format!("v{i:02}"),
            Voice {
                id: format!("v{i:02}"),
                name: format!("Voice {i}"),
                part_id: part,
            },
        );
    }
    for s in 0..32 {
        let section = format!("s{s:02}");
        let mut bar_ids = Vec::new();
        for b in 0..32 {
            let (numerator, denominator, groups) = &meters[(s as usize * 32 + b) % 4];
            let id = format!("{section}-b{b:02}");
            song.tables.bars.insert(
                id.clone(),
                Bar {
                    id: id.clone(),
                    name: format!("{numerator}/{denominator}"),
                    section_id: section.clone(),
                    numerator: *numerator,
                    denominator: *denominator,
                    groups: groups.clone(),
                    actual: None,
                },
            );
            bar_ids.push(id);
        }
        song.tables.sections.insert(
            section.clone(),
            Section {
                id: section.clone(),
                name: format!("Section {s}"),
                source_id: None,
                bar_ids,
            },
        );
        let appearance = format!("a{s:02}");
        song.tables.arrangement.insert(
            appearance.clone(),
            Arrangement {
                id: appearance.clone(),
                name: format!("Appearance {s}"),
                section_id: section,
            },
        );
        song.arrangement_order.push(appearance);
    }
    for p in 0..64 {
        let pattern = format!("riff{p:02}");
        song.tables.patterns.insert(
            pattern.clone(),
            Pattern {
                id: pattern.clone(),
                name: format!("Riff {p}"),
                groups: vec![time(4, 1)],
                length: time(4, 1),
                source_id: None,
            },
        );
        for k in 0..157 {
            let id = format!("e{p:02}-{k:03}");
            song.tables.events.insert(
                id.clone(),
                MusicalEvent {
                    id: id.clone(),
                    name: "Note".into(),
                    origin_id: id,
                    pattern_id: pattern.clone(),
                    kind: "note".into(),
                    start: time((k % 4) as i64, 1),
                    duration: time(1, 2),
                    pitch: Pitch {
                        degree: (k % 7) + 1,
                        alteration: 0,
                        octave: 0,
                    },
                    chord_id: None,
                    drum: "kick".into(),
                    accent: 0.7,
                    articulation: "normal".into(),
                    performance: vec![],
                },
            );
        }
        song.tables.occurrences.insert(
            format!("o{p:02}"),
            Occurrence {
                id: format!("o{p:02}"),
                name: format!("Occurrence {p}"),
                section_id: Some(format!("s{:02}", p % 32)),
                pattern_id: pattern,
                voice_id: format!("v{:02}", p % 32),
                start: time(0, 1),
                span: time(4, 1),
                phase: time(0, 1),
                boundary: "continue".into(),
                tails: "ring".into(),
            },
        );
    }
    song.validate().expect("reference song must validate");
    song
}

/// Audition-scale song sized inside the documented native limits (600-second
/// schedule, 120 voice-seconds of render work, 65,536 tones): 4 parts, one
/// 16-bar 4/4 section, 4 patterns of 50 short notes with staggered
/// section-bound occurrences. About 27 voice-seconds of tone work.
pub fn audition_song() -> Song {
    let instruments = ["guitar", "bass", "drums", "voice"];
    let mut song = Song {
        schema_version: 7,
        id: "audition".into(),
        title: "Audition-scale project".into(),
        mode: "major".into(),
        degree_reference: "major".into(),
        writing: Writing {
            instructions: String::new(),
            preferences: String::new(),
        },
        tempo: Tempo {
            bpm: 112.0,
            beat_unit: time(1, 1),
        },
        arrangement_order: vec![],
        tables: Tables {
            patterns: Default::default(),
            events: Default::default(),
            chords: Default::default(),
            bars: Default::default(),
            sections: Default::default(),
            arrangement: Default::default(),
            parts: Default::default(),
            voices: Default::default(),
            occurrences: Default::default(),
            prompts: Default::default(),
            assets: Default::default(),
            takes: Default::default(),
            fretted: Default::default(),
            fingerings: Default::default(),
            harmony: Default::default(),
            markers: Default::default(),
            phrases: Default::default(),
            lyrics: Default::default(),
            polyrhythms: Default::default(),
        },
    };
    for (i, instrument) in instruments.iter().enumerate() {
        let part = format!("p{i}");
        song.tables.parts.insert(
            part.clone(),
            Part {
                id: part.clone(),
                name: format!("Part {i}"),
                instrument: instrument.to_string(),
                volume: 0.8,
                muted: false,
            },
        );
        song.tables.voices.insert(
            format!("v{i}"),
            Voice {
                id: format!("v{i}"),
                name: format!("Voice {i}"),
                part_id: part,
            },
        );
    }
    let mut bar_ids = Vec::new();
    for b in 0..16 {
        let id = format!("s0-b{b:02}");
        song.tables.bars.insert(
            id.clone(),
            Bar {
                id: id.clone(),
                name: "4/4".into(),
                section_id: "s0".into(),
                numerator: 4,
                denominator: 4,
                groups: vec![2, 2],
                actual: None,
            },
        );
        bar_ids.push(id);
    }
    song.tables.sections.insert(
        "s0".into(),
        Section {
            id: "s0".into(),
            name: "Section 0".into(),
            source_id: None,
            bar_ids,
        },
    );
    song.tables.arrangement.insert(
        "a0".into(),
        Arrangement {
            id: "a0".into(),
            name: "Appearance 0".into(),
            section_id: "s0".into(),
        },
    );
    song.arrangement_order.push("a0".into());
    for p in 0..4 {
        let pattern = format!("ap{p}");
        song.tables.patterns.insert(
            pattern.clone(),
            Pattern {
                id: pattern.clone(),
                name: format!("Audition {p}"),
                groups: vec![time(4, 1)],
                length: time(4, 1),
                source_id: None,
            },
        );
        for k in 0..50 {
            let id = format!("ae{p}-{k:02}");
            song.tables.events.insert(
                id.clone(),
                MusicalEvent {
                    id: id.clone(),
                    name: "Note".into(),
                    origin_id: id,
                    pattern_id: pattern.clone(),
                    kind: "note".into(),
                    start: time((k % 4) as i64, 1),
                    duration: time(1, 4),
                    pitch: Pitch {
                        degree: (k % 7) + 1,
                        alteration: 0,
                        octave: 0,
                    },
                    chord_id: None,
                    drum: "kick".into(),
                    accent: 0.7,
                    articulation: "normal".into(),
                    performance: vec![],
                },
            );
        }
        song.tables.occurrences.insert(
            format!("ao{p}"),
            Occurrence {
                id: format!("ao{p}"),
                name: format!("Audition {p}"),
                section_id: Some("s0".into()),
                pattern_id: pattern,
                voice_id: format!("v{p}"),
                start: time((p * 4) as i64, 1),
                span: time(4, 1),
                phase: time(0, 1),
                boundary: "continue".into(),
                tails: "ring".into(),
            },
        );
    }
    song.validate().expect("audition song must validate");
    song
}

/// 100 patterns of 500 note events with global occurrences: 50,000 events for
/// stressing expansion and scheduling without arrangement overhead.
pub fn stress_song() -> Song {
    let mut song = reference_song();
    song.id = "stress".into();
    song.title = "Stress project".into();
    song.tables.patterns.clear();
    song.tables.events.clear();
    song.tables.occurrences.clear();
    song.tables.sections.clear();
    song.tables.bars.clear();
    song.tables.arrangement.clear();
    song.arrangement_order.clear();
    for p in 0..100 {
        let pattern = format!("sp{p:02}");
        song.tables.patterns.insert(
            pattern.clone(),
            Pattern {
                id: pattern.clone(),
                name: format!("Stress {p}"),
                groups: vec![time(4, 1)],
                length: time(4, 1),
                source_id: None,
            },
        );
        for k in 0..500 {
            let id = format!("se{p:02}-{k:03}");
            song.tables.events.insert(
                id.clone(),
                MusicalEvent {
                    id: id.clone(),
                    name: "Note".into(),
                    origin_id: id,
                    pattern_id: pattern.clone(),
                    kind: "note".into(),
                    start: time((k % 4) as i64, 1),
                    duration: time(1, 2),
                    pitch: Pitch {
                        degree: (k % 7) + 1,
                        alteration: 0,
                        octave: 0,
                    },
                    chord_id: None,
                    drum: "kick".into(),
                    accent: 0.7,
                    articulation: "normal".into(),
                    performance: vec![],
                },
            );
        }
        song.tables.occurrences.insert(
            format!("so{p:02}"),
            Occurrence {
                id: format!("so{p:02}"),
                name: format!("Stress {p}"),
                section_id: None,
                pattern_id: pattern,
                voice_id: "v00".into(),
                start: time(0, 1),
                span: time(4, 1),
                phase: time(0, 1),
                boundary: "continue".into(),
                tails: "ring".into(),
            },
        );
    }
    song.validate().expect("stress song must validate");
    song
}
