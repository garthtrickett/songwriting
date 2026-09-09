//! Differential analysis derivations against tests/desktop/analysis.json:
//! annotations, alignment maps, polyrhythm grids and pattern comparison.
use song_core::Song;

fn float_aware_eq(a: &serde_json::Value, b: &serde_json::Value) -> bool {
    match (a, b) {
        (serde_json::Value::Number(x), serde_json::Value::Number(y)) => {
            match (x.as_f64(), y.as_f64()) {
                (Some(x), Some(y)) => x == y,
                _ => x == y,
            }
        }
        (serde_json::Value::Array(x), serde_json::Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y.iter()).all(|(a, b)| float_aware_eq(a, b))
        }
        (serde_json::Value::Object(x), serde_json::Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(k, v)| y.get(k).is_some_and(|w| float_aware_eq(v, w)))
        }
        _ => a == b,
    }
}

fn check(
    actual: song_core::Result<serde_json::Value>,
    expected: &serde_json::Value,
    context: &str,
) {
    match actual {
        Ok(value) => {
            assert_eq!(expected["ok"], true, "{context}");
            assert!(
                float_aware_eq(&value, &expected["value"]),
                "{context}\nactual: {value}\nexpected: {}",
                expected["value"]
            );
        }
        Err(error) => {
            assert_eq!(expected["ok"], false, "{context}");
            assert_eq!(error.message, expected["error"], "{context}");
        }
    }
}

/// Voice/note order follows expansion order, which differs by map ordering;
/// canonicalize both sides and compare content exactly.
fn canonical_sounding(mut value: serde_json::Value) -> serde_json::Value {
    if let Some(voices) = value.get_mut("voices").and_then(|v| v.as_array_mut()) {
        for voice in voices.iter_mut() {
            if let Some(notes) = voice.get_mut("notes").and_then(|v| v.as_array_mut()) {
                notes.sort_by_key(|n| {
                    (
                        n["start"][0].as_i64().unwrap(),
                        n["start"][1].as_i64().unwrap(),
                        n["eventId"].as_str().unwrap().to_string(),
                        n["pitch"]["degree"].as_i64().unwrap(),
                        n["pitch"]["alteration"].as_i64().unwrap(),
                        n["pitch"]["octave"].as_i64().unwrap(),
                    )
                });
            }
        }
        voices.sort_by_key(|v| v["id"].as_str().unwrap().to_string());
    }
    value
}

#[test]
fn analysis_derivations_match_typescript() {
    let case: serde_json::Value =
        serde_json::from_str(include_str!("../../../../tests/desktop/analysis.json")).unwrap();
    let case = &case[0];
    let song: Song = serde_json::from_value(case["song"].clone()).unwrap();
    song.validate().unwrap();
    check(
        song_core::annotations(&song).map(|v| serde_json::to_value(v).unwrap()),
        &case["annotations"],
        "annotations",
    );
    let until = song_core::song_end(&song).unwrap();
    let ids = |ids: &[&str]| ids.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    check(
        song_core::alignment_map(
            &song,
            &ids(&["lead1", "lead2"]),
            song_core::Time::ZERO,
            until,
        )
        .map(|v| serde_json::to_value(v).unwrap()),
        &case["alignment"],
        "alignment",
    );
    for (key, arguments) in [
        ("alignmentSingle", vec!["lead1"]),
        ("alignmentUnknown", vec!["lead1", "gone"]),
        (
            "alignmentMany",
            vec!["a", "b", "c", "d", "e", "f", "g", "h", "i"],
        ),
    ] {
        check(
            song_core::alignment_map(&song, &ids(&arguments), song_core::Time::ZERO, until)
                .map(|v| serde_json::to_value(v).unwrap()),
            &case[key],
            key,
        );
    }
    check(
        song_core::alignment_map(
            &song,
            &ids(&["lead1", "lead2"]),
            serde_json::from_value(serde_json::json!([2, 1])).unwrap(),
            serde_json::from_value(serde_json::json!([1, 1])).unwrap(),
        )
        .map(|v| serde_json::to_value(v).unwrap()),
        &case["alignmentRange"],
        "alignmentRange",
    );
    check(
        song_core::polyrhythm_grid(&song, "p1").map(|v| serde_json::to_value(v).unwrap()),
        &case["grid"],
        "grid",
    );
    check(
        song_core::polyrhythm_grid(&song, "gone").map(|v| serde_json::to_value(v).unwrap()),
        &case["gridUnknown"],
        "gridUnknown",
    );
    check(
        song_core::compare_patterns(&song, "riff", "riff2")
            .map(|v| serde_json::to_value(v).unwrap()),
        &case["compare"],
        "compare",
    );
    check(
        song_core::compare_patterns(&song, "riff", "gone")
            .map(|v| serde_json::to_value(v).unwrap()),
        &case["compareUnknown"],
        "compareUnknown",
    );
    let harmony = &case["harmony"];
    check(
        song_core::harmonic_spans(&song).map(|v| serde_json::to_value(v).unwrap()),
        &harmony["spans"],
        "spans",
    );
    for (key, at) in [
        ("contextEarly", [0, 1]),
        ("contextLater", [5, 1]),
        ("contextEmpty", [8, 1]),
    ] {
        check(
            song_core::harmonic_context(&song, song_core::Time::new(at[0], at[1]).unwrap())
                .map(|v| serde_json::to_value(v).unwrap()),
            &harmony[key],
            key,
        );
    }
    check(
        song_core::harmonic_context(&song, song_core::Time::new(-1, 1).unwrap())
            .map(|v| serde_json::to_value(v).unwrap()),
        &harmony["contextNegative"],
        "contextNegative",
    );
    let chord_notes: Vec<song_core::Pitch> = song.tables.chords["chord"]
        .notes
        .iter()
        .map(|n| n.pitch.clone())
        .collect();
    check(
        song_core::interpretations(
            &chord_notes,
            &song_core::Pitch {
                degree: 1,
                alteration: 0,
                octave: 0,
            },
            "major",
        )
        .map(|v| serde_json::to_value(v).unwrap()),
        &harmony["interpretChord"],
        "interpretChord",
    );
    check(
        song_core::interpretations(
            &[song_core::Pitch {
                degree: 8,
                alteration: 0,
                octave: 0,
            }],
            &song_core::Pitch {
                degree: 1,
                alteration: 0,
                octave: 0,
            },
            "major",
        )
        .map(|v| serde_json::to_value(v).unwrap()),
        &harmony["interpretInvalid"],
        "interpretInvalid",
    );
    check(
        song_core::interpretations(
            &vec![
                song_core::Pitch {
                    degree: 1,
                    alteration: 0,
                    octave: 0,
                };
                65
            ],
            &song_core::Pitch {
                degree: 1,
                alteration: 0,
                octave: 0,
            },
            "major",
        )
        .map(|v| serde_json::to_value(v).unwrap()),
        &harmony["interpretMany"],
        "interpretMany",
    );
    check(
        song_core::chord_candidates(&song, "chord", None, None)
            .map(|v| serde_json::to_value(v).unwrap()),
        &harmony["candidates"],
        "candidates",
    );
    check(
        song_core::chord_candidates(&song, "gone", None, None)
            .map(|v| serde_json::to_value(v).unwrap()),
        &harmony["candidatesUnknown"],
        "candidatesUnknown",
    );
    for (key, at) in [("soundingEarly", [1, 1]), ("soundingEmpty", [8, 1])] {
        match song_core::sounding_harmony(&song, song_core::Time::new(at[0], at[1]).unwrap()) {
            Ok(value) => {
                assert_eq!(case["harmony"][key]["ok"], true, "{key}");
                let actual = canonical_sounding(serde_json::to_value(value).unwrap());
                let expected = canonical_sounding(case["harmony"][key]["value"].clone());
                assert!(
                    float_aware_eq(&actual, &expected),
                    "{key}\nactual: {actual}\nexpected: {expected}"
                );
            }
            Err(error) => {
                assert_eq!(case["harmony"][key]["ok"], false, "{key}");
                assert_eq!(error.message, case["harmony"][key]["error"], "{key}");
            }
        }
    }
}

#[test]
fn fretted_tablature_and_take_placements_match_typescript() {
    let cases: serde_json::Value =
        serde_json::from_str(include_str!("../../../../tests/desktop/analysis.json")).unwrap();
    let case = &cases[1];
    assert_eq!(case["name"], "tabtakes");
    // Takes stay schemaless until slice 5, so this variant is derived, not validated.
    let song: Song = serde_json::from_value(case["song"].clone()).unwrap();
    let time = |n: i64, d: i64| song_core::Time::new(n, d).unwrap();
    check(
        song_core::tablature(&song, "tab1", time(0, 1), time(17, 2))
            .map(|v| serde_json::to_value(v).unwrap()),
        &case["tab"],
        "tab",
    );
    for (key, arrangement, from, until) in [
        ("tabUnknown", "gone", [0, 1], [17, 2]),
        ("tabRange", "tab1", [2, 1], [1, 1]),
    ] {
        check(
            song_core::tablature(
                &song,
                arrangement,
                time(from[0], from[1]),
                time(until[0], until[1]),
            )
            .map(|v| serde_json::to_value(v).unwrap()),
            &case[key],
            key,
        );
    }
    check(
        song_core::fret_positions(&song, "tab1", "lead1", "harmony", Some("root"))
            .map(|v| serde_json::to_value(v).unwrap()),
        &case["positions"],
        "positions",
    );
    check(
        song_core::fret_positions(&song, "gone", "lead1", "harmony", Some("root"))
            .map(|v| serde_json::to_value(v).unwrap()),
        &case["positionsUnknown"],
        "positionsUnknown",
    );
    let arrangement = song.tables.fretted["tab1"].clone();
    check(
        song_core::target_pitch(&song, &arrangement, "lead1", "harmony", Some("root"))
            .map(|v| serde_json::to_value(v).unwrap()),
        &case["target"],
        "target",
    );
    check(
        song_core::target_pitch(&song, &arrangement, "lead1", "gone", None)
            .map(|v| serde_json::to_value(v).unwrap()),
        &case["targetStale"],
        "targetStale",
    );
    let fingering = song.tables.fingerings["f1"].clone();
    check(
        Ok(serde_json::to_value(song_core::fingering_issues(&song, &fingering)).unwrap()),
        &case["issues"],
        "issues",
    );
    check(
        song_core::take_placements(&song).map(|v| serde_json::to_value(v).unwrap()),
        &case["placements"],
        "placements",
    );
}
