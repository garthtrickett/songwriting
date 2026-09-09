//! Voice-leading assignment between two chords. Mirrors voiceLeading in
//! voice-leading.ts: semitone-sorted sources, octave-shift options within the
//! radius, and a bitmask shortest-assignment pass.
use crate::{
    Note, Pitch, Result,
    harmony_pitch::{semitone, shift_pitch},
};
use crate::{Song, ensure};
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceMove {
    pub source_member_id: Option<String>,
    pub target_member_id: Option<String>,
    pub from: Option<Pitch>,
    pub to: Option<Pitch>,
    pub semitones: Option<i32>,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceLeading {
    pub source_id: String,
    pub target_id: String,
    pub octave_radius: i32,
    pub total_motion: i32,
    pub moves: Vec<VoiceMove>,
    pub notes: Vec<Note>,
    pub affected_events: Vec<String>,
}

pub fn voice_leading(
    song: &Song,
    source_id: &str,
    target_id: &str,
    radius: i32,
) -> Result<VoiceLeading> {
    let source = song.tables.chords.get(source_id);
    let target = song.tables.chords.get(target_id);
    ensure(
        source.is_some() && target.is_some(),
        "Choose two chords",
    )?;
    let (source, target) = (source.unwrap(), target.unwrap());
    ensure(
        source.notes.len() <= 8
            && target.notes.len() <= 8
            && (0..=2).contains(&radius),
        "Voice leading supports 1–8 notes per chord and octave radius 0–2",
    )?;
    let mut left = source.notes.clone();
    left.sort_by_key(|note| semitone(&note.pitch));
    let right = &target.notes;
    let n = left.len().max(right.len());
    // Cost matrix with octave-shifted options; ties keep generation order.
    let mut matrix = vec![vec![(0i32, None); n]; n];
    for i in 0..n {
        for j in 0..n {
            let (a, b) = (left.get(i), right.get(j));
            if a.is_none() || b.is_none() {
                matrix[i][j] = (0, b.map(|note| note.pitch.clone()));
                continue;
            }
            let (a, b) = (a.unwrap(), b.unwrap());
            let mut offsets = vec![0i64];
            for k in 1..=i64::from(radius) {
                offsets.push(-k);
                offsets.push(k);
            }
            let mut options = Vec::new();
            for k in offsets {
                if let Ok(pitch) = shift_pitch(&b.pitch, k * 7, k * 12) {
                    options.push((
                        (semitone(&pitch) - semitone(&a.pitch)).abs(),
                        pitch,
                    ));
                }
            }
            options.sort_by_key(|(cost, _)| *cost);
            let (cost, pitch) = options.into_iter().next().unwrap();
            matrix[i][j] = (cost, Some(pitch));
        }
    }
    // Bitmask shortest assignment over rows.
    let mut memo = BTreeMap::new();
    fn solve(
        matrix: &[Vec<(i32, Option<Pitch>)>],
        memo: &mut BTreeMap<u32, (i32, Vec<usize>)>,
        n: usize,
        row: usize,
        mask: u32,
    ) -> (i32, Vec<usize>) {
        if row == n {
            return (0, vec![]);
        }
        if let Some(known) = memo.get(&mask) {
            return known.clone();
        }
        let mut best = (i32::MAX, vec![]);
        for j in 0..n {
            if mask & (1 << j) == 0 {
                let (rest_cost, rest_columns) = solve(matrix, memo, n, row + 1, mask | (1 << j));
                let cost = matrix[row][j].0 + rest_cost;
                if cost < best.0 {
                    let mut columns = vec![j];
                    columns.extend(rest_columns);
                    best = (cost, columns);
                }
            }
        }
        memo.insert(mask, best.clone());
        best
    }
    let (total_motion, columns) = solve(&matrix, &mut memo, n, 0, 0);
    let mut notes: Vec<Note> = right.clone();
    let mut moves = Vec::new();
    for (i, j) in columns.iter().enumerate() {
        let before = left.get(i);
        let after = right.get(*j);
        let pitch = matrix[i][*j].1.clone();
        if after.is_some() && pitch.is_some() {
            notes[*j].pitch = pitch.clone().unwrap();
        }
        moves.push(VoiceMove {
            source_member_id: before.map(|note| note.id.clone()),
            target_member_id: after.map(|note| note.id.clone()),
            from: before.map(|note| note.pitch.clone()),
            to: pitch.clone(),
            semitones: match (before, &pitch) {
                (Some(before), Some(pitch)) => {
                    Some(semitone(pitch) - semitone(&before.pitch))
                }
                _ => None,
            },
            status: if before.is_none() {
                "added".into()
            } else if after.is_none() {
                "removed".into()
            } else {
                "matched".into()
            },
        });
    }
    Ok(VoiceLeading {
        source_id: source_id.into(),
        target_id: target_id.into(),
        octave_radius: radius,
        total_motion,
        moves,
        notes,
        affected_events: song
            .tables
            .events
            .values()
            .filter(|e| e.chord_id.as_deref() == Some(target_id))
            .map(|e| e.id.clone())
            .collect(),
    })
}
