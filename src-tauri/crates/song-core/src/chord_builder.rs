//! Chord construction from Roman-root recipes. Mirrors chord-builder.ts.
use crate::{
    Pitch,
    harmony_pitch::{checked_pitch, roman_pitch, roman_root, semitone, shift_pitch},
};
use crate::{Result, ensure};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const QUALITIES: [&str; 7] = [
    "major",
    "minor",
    "diminished",
    "augmented",
    "sus2",
    "sus4",
    "power",
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct RecipeTone {
    pub degree: i32,
    pub alteration: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ChordRecipe {
    pub root: String,
    pub quality: String,
    pub extension: i32,
    pub seventh: String,
    pub tones: Vec<RecipeTone>,
    pub omit: Vec<i32>,
    pub inversion: i32,
    pub octave: i32,
    pub target: Option<String>,
    #[ts(type = "{ degree: number, alteration: number, octave: number }")]
    pub tonic: Pitch,
}

fn integer(value: i32, lo: i32, hi: i32) -> bool {
    (lo..=hi).contains(&value)
}

pub fn build_chord(id: String, name: String, recipe: &ChordRecipe) -> Result<crate::Chord> {
    ensure(
        QUALITIES.contains(&recipe.quality.as_str())
            && [0, 6, 7, 9, 11, 13].contains(&recipe.extension)
            && ["major", "minor", "diminished"].contains(&recipe.seventh.as_str()),
        "Choose chord quality, extension and seventh quality",
    )?;
    ensure(
        !(recipe.extension >= 7
            && recipe.seventh == "diminished"
            && recipe.quality != "diminished"),
        "Diminished sevenths require diminished quality; use an added sixth for other qualities",
    )?;
    checked_pitch(&recipe.tonic)?;
    ensure(
        recipe.tones.len() <= 13
            && recipe.omit.len() <= 13
            && recipe
                .omit
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                == recipe.omit.len()
            && recipe.omit.iter().all(|n| integer(*n, 1, 13))
            && recipe.octave.abs() <= 4,
        "Invalid chord tones, omissions or octave",
    )?;
    let root = roman_root(&recipe.root)?;
    let target = recipe.target.as_ref().map(|t| roman_root(t)).transpose()?;
    let base = match &target {
        Some(target) => shift_pitch(
            &recipe.tonic,
            i64::from(target.degree - 1),
            i64::from(semitone(target)),
        )?,
        None => recipe.tonic.clone(),
    };
    let pitch = shift_pitch(
        &base,
        i64::from(root.degree - 1 + 7 * recipe.octave),
        i64::from(semitone(&root)) + 12 * i64::from(recipe.octave),
    )?;
    let thirds = match recipe.quality.as_str() {
        "major" => 4,
        "minor" => 3,
        "diminished" => 3,
        "augmented" => 4,
        "sus2" => 2,
        "sus4" => 5,
        _ => 0,
    };
    let mut tone_map = BTreeMap::from([
        (1, 0),
        (
            5,
            if recipe.quality == "diminished" {
                6
            } else if recipe.quality == "augmented" {
                8
            } else {
                7
            },
        ),
    ]);
    if recipe.quality != "power" {
        tone_map.insert(
            if recipe.quality == "sus2" {
                2
            } else if recipe.quality == "sus4" {
                4
            } else {
                3
            },
            thirds,
        );
    }
    if recipe.extension == 6 {
        tone_map.insert(6, 9);
    }
    if recipe.extension >= 7 {
        tone_map.insert(
            7,
            if recipe.seventh == "major" {
                11
            } else if recipe.seventh == "minor" {
                10
            } else {
                9
            },
        );
    }
    if recipe.extension >= 9 {
        tone_map.insert(9, 14);
    }
    if recipe.extension >= 11 {
        tone_map.insert(11, 17);
    }
    if recipe.extension >= 13 {
        tone_map.insert(13, 21);
    }
    let natural = [0, 2, 4, 5, 7, 9, 11];
    let mut modified = std::collections::BTreeSet::new();
    for tone in &recipe.tones {
        ensure(
            (1..=13).contains(&tone.degree)
                && (-2..=2).contains(&tone.alteration)
                && modified.insert(tone.degree),
            "Added/altered tones need unique degrees 1–13 and alterations -2…2",
        )?;
        tone_map.insert(
            tone.degree,
            natural[((tone.degree - 1) % 7) as usize]
                + 12 * ((tone.degree - 1) / 7)
                + tone.alteration,
        );
    }
    for degree in &recipe.omit {
        tone_map.remove(degree);
    }
    ensure(
        !tone_map.is_empty(),
        "A chord must retain at least one note",
    )?;
    let has_third = tone_map.contains_key(&3);
    // Sorted by sounding pitch; ties keep degree order on both sides.
    let mut notes: Vec<(i32, crate::Note)> = tone_map
        .into_iter()
        .map(|(degree, n)| {
            shift_pitch(&pitch, i64::from(degree - 1), i64::from(n)).map(|pitch| {
                (
                    semitone(&pitch),
                    crate::Note {
                        id: format!("tone-{degree}"),
                        pitch,
                    },
                )
            })
        })
        .collect::<Result<Vec<_>>>()?;
    notes.sort_by_key(|(semitones, _)| *semitones);
    let mut notes: Vec<crate::Note> = notes.into_iter().map(|(_, note)| note).collect();
    ensure(
        recipe.inversion >= 0 && (recipe.inversion as usize) < notes.len(),
        "Inversion must select a retained chord tone",
    )?;
    for _ in 0..recipe.inversion {
        let mut note = notes.remove(0);
        loop {
            note.pitch = shift_pitch(&note.pitch, 7, 12)?;
            let last = semitone(&notes.last().expect("retained note").pitch);
            if semitone(&note.pitch) > last {
                break;
            }
        }
        notes.push(note);
    }
    let mut suffix = if recipe.quality == "diminished" {
        if recipe.extension >= 7 && recipe.seventh == "minor" {
            "ø"
        } else {
            "°"
        }
    } else if recipe.quality == "augmented" {
        "+"
    } else if recipe.quality == "power" && recipe.extension == 0 {
        "5"
    } else {
        ""
    }
    .to_string();
    if recipe.extension != 0 {
        suffix += &format!(
            "{}{}",
            if recipe.extension >= 7 && recipe.seventh == "major" {
                "maj"
            } else {
                ""
            },
            recipe.extension
        );
    }
    if recipe.quality.starts_with("sus") {
        suffix += &recipe.quality;
    }
    let mut details: Vec<String> = recipe
        .tones
        .iter()
        .map(|t| {
            let accidental = if t.alteration < 0 {
                "♭".repeat((-t.alteration) as usize)
            } else {
                "♯".repeat(t.alteration as usize)
            };
            format!("{accidental}{}", t.degree)
        })
        .chain(recipe.omit.iter().map(|n| format!("no{n}")))
        .collect();
    if recipe.quality == "power" && recipe.extension != 0 && !has_third && !recipe.omit.contains(&3)
    {
        details.push("no3".into());
    }
    if recipe.inversion != 0 {
        details.push(format!(
            "bass {}",
            notes[0].id.strip_prefix("tone-").unwrap_or(&notes[0].id)
        ));
    }
    Ok(crate::Chord {
        id,
        name,
        notes,
        label_tonic: recipe.tonic.clone(),
        label: Some(format!(
            "{}{}{}{}",
            roman_pitch(
                &root,
                recipe.quality == "minor" || recipe.quality == "diminished"
            ),
            suffix,
            recipe
                .target
                .as_ref()
                .map(|t| format!("/{t}"))
                .unwrap_or_default(),
            if details.is_empty() {
                String::new()
            } else {
                format!("({})", details.join(","))
            }
        )),
    })
}
