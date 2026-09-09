//! Harmony analysis derivations: region spans, context lookup, chord
//! interpretation, candidates and sounding harmony. Mirrors
//! harmony-analysis.ts.
use crate::{
    Pitch, Result, Song, Time,
    chord_builder::{QUALITIES, build_chord},
    harmony_pitch::{checked_pitch, pitch_class, relative_pitch, roman_pitch, semitone},
};
use crate::{ensure, lookup};
use serde::Serialize;
use std::collections::BTreeSet;

pub const TONIC: Pitch = Pitch {
    degree: 1,
    alteration: 0,
    octave: 0,
};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarmonicSpan {
    pub id: String,
    pub name: String,
    pub section_id: Option<String>,
    pub start: Time,
    pub duration: Time,
    pub tonic: Pitch,
    pub mode: String,
    pub annotation: String,
    pub appearance_id: Option<String>,
}

pub fn harmonic_spans(song: &Song) -> Result<Vec<HarmonicSpan>> {
    let appearances = crate::section_spans(song)?;
    let mut out = Vec::new();
    for region in song.tables.harmony.values() {
        let base = HarmonicSpan {
            id: region.id.clone(),
            name: region.name.clone(),
            section_id: region.section_id.clone(),
            start: region.start,
            duration: region.duration,
            tonic: region.tonic.clone(),
            mode: region.mode.clone(),
            annotation: region.annotation.clone(),
            appearance_id: None,
        };
        match &region.section_id {
            None => out.push(base),
            Some(section) => {
                for appearance in appearances.iter().filter(|a| &a.section_id == section) {
                    out.push(HarmonicSpan {
                        start: appearance.start.checked_add(region.start)?,
                        appearance_id: Some(appearance.id.clone()),
                        ..base.clone()
                    });
                }
            }
        }
        ensure(out.len() <= 100000, "Too many harmonic region appearances")?;
    }
    out.sort_by_key(|span| span.start);
    Ok(out)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarmonicContext {
    pub at: Time,
    pub region_id: Option<String>,
    pub tonic: Pitch,
    pub mode: String,
    pub annotation: String,
}

pub fn harmonic_context(song: &Song, at: Time) -> Result<HarmonicContext> {
    ensure(
        at >= Time::ZERO,
        "Use an exact nonnegative context position",
    )?;
    let active: Vec<_> = harmonic_spans(song)?
        .into_iter()
        .filter(|span| {
            at >= span.start && at < span.start.checked_add(span.duration).unwrap_or(Time::ZERO)
        })
        .collect();
    let current = active
        .iter()
        .find(|span| span.section_id.is_some())
        .or(active.first());
    Ok(HarmonicContext {
        at,
        region_id: current.map(|span| span.id.clone()),
        tonic: current.map_or(TONIC, |span| span.tonic.clone()),
        mode: current.map_or(song.mode.clone(), |span| span.mode.clone()),
        annotation: current.map_or(String::new(), |span| span.annotation.clone()),
    })
}

fn modes(name: &str) -> Option<&'static [i32]> {
    match name.to_lowercase().as_str() {
        "major" => Some(&[0, 2, 4, 5, 7, 9, 11]),
        "minor" => Some(&[0, 2, 3, 5, 7, 8, 10]),
        "dorian" => Some(&[0, 2, 3, 5, 7, 9, 10]),
        "phrygian" => Some(&[0, 1, 3, 5, 7, 8, 10]),
        "lydian" => Some(&[0, 2, 4, 6, 7, 9, 11]),
        "mixolydian" => Some(&[0, 2, 4, 5, 7, 9, 10]),
        "locrian" => Some(&[0, 1, 3, 5, 6, 8, 10]),
        "harmonic minor" => Some(&[0, 2, 3, 5, 7, 8, 11]),
        "melodic minor" => Some(&[0, 2, 3, 5, 7, 9, 11]),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChordCandidate {
    pub symbol: String,
    pub root: Pitch,
    pub bass: Pitch,
    pub quality: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Interpretations {
    pub pitch_classes: Vec<i32>,
    pub bass: Option<Pitch>,
    pub in_mode: Option<bool>,
    pub candidates: Vec<ChordCandidate>,
    pub total_candidates: usize,
    pub truncated: bool,
    pub unresolved: bool,
}

pub fn interpretations(notes: &[Pitch], tonic: &Pitch, mode: &str) -> Result<Interpretations> {
    checked_pitch(tonic)?;
    for pitch in notes {
        checked_pitch(pitch)?;
    }
    ensure(notes.len() <= 64, "Inspect at most 64 distinct pitches")?;
    let mut classes: Vec<i32> = notes.iter().map(|p| pitch_class(semitone(p))).collect();
    classes.sort();
    classes.dedup();
    let in_mode = modes(mode).map(|steps| {
        classes
            .iter()
            .all(|n| steps.contains(&pitch_class(n - semitone(tonic))))
    });
    let mut by_pitch = notes.to_vec();
    by_pitch.sort_by_key(semitone);
    let bass = by_pitch.first().cloned();
    let mut candidates = Vec::new();
    if let Some(bass) = &bass {
        let mut seen = BTreeSet::new();
        let mut distinct = Vec::new();
        for pitch in notes {
            if seen.insert(pitch_class(semitone(pitch))) {
                distinct.push(pitch);
            }
        }
        for note in distinct {
            let mut root = match relative_pitch(note, tonic) {
                Ok(root) => root,
                Err(_) => continue,
            };
            root.octave = 0;
            for quality in QUALITIES {
                for extension in [0, 6, 7, 9, 11, 13] {
                    let sevenths: &[&str] = if extension >= 7 {
                        if quality == "diminished" {
                            &["major", "minor", "diminished"]
                        } else {
                            &["major", "minor"]
                        }
                    } else {
                        &["minor"]
                    };
                    for seventh in sevenths {
                        if quality == "power" && extension != 0 {
                            continue;
                        }
                        let built = build_chord(
                            "candidate".into(),
                            "Candidate".into(),
                            &crate::chord_builder::ChordRecipe {
                                root: roman_pitch(&root, false),
                                quality: quality.into(),
                                extension,
                                seventh: seventh.to_string(),
                                tones: vec![],
                                omit: vec![],
                                inversion: 0,
                                octave: 0,
                                target: None,
                                tonic: tonic.clone(),
                            },
                        );
                        let chord = match built {
                            Ok(chord) => chord,
                            Err(_) => continue,
                        };
                        let mut pcs: Vec<i32> = chord
                            .notes
                            .iter()
                            .map(|n| pitch_class(semitone(&n.pitch)))
                            .collect();
                        pcs.sort();
                        pcs.dedup();
                        if pcs == classes {
                            candidates.push(ChordCandidate {
                                symbol: chord.label.clone().expect("builder labels"),
                                root: chord.notes[0].pitch.clone(),
                                bass: bass.clone(),
                                quality: quality.into(),
                            });
                        }
                    }
                }
            }
        }
    }
    let total_candidates = candidates.len();
    Ok(Interpretations {
        pitch_classes: classes,
        bass,
        in_mode,
        candidates: candidates.into_iter().take(32).collect(),
        total_candidates,
        truncated: total_candidates > 32,
        unresolved: total_candidates == 0,
    })
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChordCandidates {
    pub chord_id: String,
    pub label: Option<String>,
    pub tonic: Pitch,
    pub pitch_classes: Vec<i32>,
    pub bass: Option<Pitch>,
    pub in_mode: Option<bool>,
    pub candidates: Vec<ChordCandidate>,
    pub total_candidates: usize,
    pub truncated: bool,
    pub unresolved: bool,
}

pub fn chord_candidates(
    song: &Song,
    id: &str,
    tonic: Option<&Pitch>,
    mode: Option<&str>,
) -> Result<ChordCandidates> {
    let chord = song
        .tables
        .chords
        .get(id)
        .ok_or_else(|| crate::Error::new("invalid", "Unknown chord"))?
        .clone();
    let reference = tonic.cloned().unwrap_or_else(|| chord.label_tonic.clone());
    let interpretations = interpretations(
        &chord
            .notes
            .iter()
            .map(|n| n.pitch.clone())
            .collect::<Vec<_>>(),
        &reference,
        mode.unwrap_or(song.mode.as_str()),
    )?;
    Ok(ChordCandidates {
        chord_id: id.into(),
        label: chord.label,
        tonic: reference,
        pitch_classes: interpretations.pitch_classes,
        bass: interpretations.bass,
        in_mode: interpretations.in_mode,
        candidates: interpretations.candidates,
        total_candidates: interpretations.total_candidates,
        truncated: interpretations.truncated,
        unresolved: interpretations.unresolved,
    })
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundingNote {
    pub event_id: String,
    pub pitch: Pitch,
    pub start: Time,
    pub duration: Time,
    pub gain: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundingVoice {
    pub id: String,
    pub name: String,
    pub notes: Vec<SoundingNote>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundingHarmony {
    pub context: HarmonicContext,
    pub voices: Vec<SoundingVoice>,
    pub pitch_classes: Vec<i32>,
    pub bass: Option<Pitch>,
    pub in_mode: Option<bool>,
    pub candidates: Vec<ChordCandidate>,
    pub total_candidates: usize,
    pub truncated: bool,
    pub unresolved: bool,
}

pub fn sounding_harmony(song: &Song, at: Time) -> Result<SoundingHarmony> {
    let context = harmonic_context(song, at)?;
    let active: Vec<_> = crate::sounds(song)?
        .into_iter()
        .filter(|n| {
            n.pitch.is_some()
                && n.gain > 0.0
                && n.start <= at
                && at < n.start.checked_add(n.duration).unwrap_or(Time::ZERO)
        })
        .collect();
    let mut seen = BTreeSet::new();
    let mut unique = Vec::new();
    for note in &active {
        let label = crate::pitch_label(note.pitch.as_ref().unwrap());
        if seen.insert(label) {
            unique.push(note.pitch.clone().unwrap());
        }
    }
    let mut voices = Vec::new();
    let mut voice_ids = Vec::new();
    for note in &active {
        if !voice_ids.contains(&note.voice_id) {
            voice_ids.push(note.voice_id.clone());
        }
    }
    for id in voice_ids {
        let voice = lookup(&song.tables.voices, "voice", &id)?;
        voices.push(SoundingVoice {
            id: id.clone(),
            name: voice.name.clone(),
            notes: active
                .iter()
                .filter(|n| n.voice_id == id)
                .map(|n| SoundingNote {
                    event_id: n.event_id.clone(),
                    pitch: n.pitch.clone().unwrap(),
                    start: n.start,
                    duration: n.duration,
                    gain: n.gain,
                })
                .collect(),
        });
    }
    ensure(
        active.len() <= 512,
        "Too many simultaneous sounds to inspect",
    )?;
    let interpretations = interpretations(&unique, &context.tonic, &context.mode)?;
    Ok(SoundingHarmony {
        context,
        voices,
        pitch_classes: interpretations.pitch_classes,
        bass: interpretations.bass,
        in_mode: interpretations.in_mode,
        candidates: interpretations.candidates,
        total_candidates: interpretations.total_candidates,
        truncated: interpretations.truncated,
        unresolved: interpretations.unresolved,
    })
}
