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
}
