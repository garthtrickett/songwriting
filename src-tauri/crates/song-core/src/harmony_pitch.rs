//! Relative-pitch arithmetic. Mirrors harmony-pitch.ts: semitone mapping,
//! range-checked pitches, diatonic shifts, Roman roots and pitch classes.
use crate::{Pitch, Result, ensure};

pub const MAJOR: [i32; 7] = [0, 2, 4, 5, 7, 9, 11];
const ROMAN: [&str; 7] = ["I", "II", "III", "IV", "V", "VI", "VII"];

pub fn semitone(pitch: &Pitch) -> i32 {
    MAJOR[(pitch.degree - 1) as usize] + pitch.alteration + 12 * pitch.octave
}

pub fn checked_pitch(pitch: &Pitch) -> Result<Pitch> {
    ensure(
        (1..=7).contains(&pitch.degree)
            && (-4..=4).contains(&pitch.alteration)
            && (-5..=5).contains(&pitch.octave),
        "Relative pitch outside supported range",
    )?;
    Ok(pitch.clone())
}

pub fn shift_pitch(pitch: &Pitch, steps: i64, semitones: i64) -> Result<Pitch> {
    checked_pitch(pitch)?;
    let d = i64::from(pitch.octave) * 7 + i64::from(pitch.degree) - 1 + steps;
    // Euclidean division matches Math.floor for negative distances.
    let octave = d.div_euclid(7);
    let degree = d - octave * 7 + 1;
    let alteration =
        i64::from(semitone(pitch)) + semitones - (i64::from(MAJOR[(degree - 1) as usize]) + octave * 12);
    ensure(
        (-5..=5).contains(&octave) && (-4..=4).contains(&alteration),
        "Relative pitch outside supported range",
    )?;
    Ok(Pitch {
        degree: degree as i32,
        octave: octave as i32,
        alteration: alteration as i32,
    })
}

/// Integer validation with the transpose error message.
pub fn integer_value(value: f64) -> Result<i64> {
    ensure(
        value.fract() == 0.0 && value.abs() <= crate::MAX_SAFE_INTEGER as f64,
        "Intervals require integer steps and semitones",
    )?;
    Ok(value as i64)
}

pub fn relative_pitch(pitch: &Pitch, tonic: &Pitch) -> Result<Pitch> {
    checked_pitch(tonic)?;
    shift_pitch(
        pitch,
        -i64::from(tonic.degree - 1 + 7 * tonic.octave),
        -i64::from(semitone(tonic)),
    )
}

pub fn roman_root(text: &str) -> Result<Pitch> {
    let chars: Vec<char> = text.trim().chars().collect();
    // Longest numeral first so VII matches before V and III before II.
    let numeral = ["VII", "III", "VI", "IV", "II", "V", "I"]
        .into_iter()
        .find(|numeral| {
            let tail: Vec<char> = numeral.chars().collect();
            chars.len() >= tail.len()
                && chars[chars.len() - tail.len()..]
                    .iter()
                    .zip(tail.iter())
                    .all(|(a, b)| a.eq_ignore_ascii_case(b))
        });
    let Some(numeral) = numeral else {
        return Err(crate::Error::new(
            "invalid",
            "Roman root must be I–VII with optional flats or sharps",
        ));
    };
    let prefix = &chars[..chars.len() - numeral.len()];
    ensure(
        prefix.len() <= 4 && prefix.iter().all(|c| matches!(c, 'b' | '♭' | '#' | '♯')),
        "Roman root must be I–VII with optional flats or sharps",
    )?;
    let alteration = prefix
        .iter()
        .map(|c| if *c == 'b' || *c == '♭' { -1 } else { 1 })
        .sum();
    Ok(Pitch {
        degree: ROMAN.iter().position(|r| *r == numeral).unwrap() as i32 + 1,
        alteration,
        octave: 0,
    })
}

pub fn roman_pitch(pitch: &Pitch, minor: bool) -> String {
    let numeral = ROMAN[(pitch.degree - 1) as usize];
    let accidental = if pitch.alteration < 0 {
        "♭".repeat((-pitch.alteration) as usize)
    } else {
        "♯".repeat(pitch.alteration as usize)
    };
    format!(
        "{accidental}{}",
        if minor {
            numeral.to_lowercase()
        } else {
            numeral.to_string()
        }
    )
}

pub fn pitch_class(n: i32) -> i32 {
    n.rem_euclid(12)
}
