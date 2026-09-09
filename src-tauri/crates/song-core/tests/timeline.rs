//! Differential timeline expansion against tests/desktop/timeline.json.
//! The reference is insertion-ordered while Rust tables sort by key, so
//! multi-occurrence expansions are canonicalized before comparison and floats
//! compare numerically (JSON has no float spelling).
use serde_json::Value;
use song_core::{Song, Time};
use std::collections::BTreeMap;

fn float_aware_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => match (x.as_f64(), y.as_f64()) {
            (Some(x), Some(y)) => x == y,
            _ => x == y,
        },
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y.iter()).all(|(a, b)| float_aware_eq(a, b))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(k, v)| y.get(k).is_some_and(|w| float_aware_eq(v, w)))
        }
        _ => a == b,
    }
}

fn assert_json(actual: Value, expected: &Value, context: &str) {
    assert!(
        float_aware_eq(&actual, expected),
        "{context}\nactual: {actual}\nexpected: {expected}"
    );
}

fn sound_key(sound: &Value) -> (i64, i64, String) {
    let start = sound["start"].as_array().unwrap();
    (
        start[0].as_i64().unwrap(),
        start[1].as_i64().unwrap(),
        sound["id"].as_str().unwrap().into(),
    )
}

fn canonical(mut sounds: Vec<Value>) -> Vec<Value> {
    sounds.sort_by_key(sound_key);
    sounds
}

#[test]
fn timeline_expansion_matches_typescript_on_all_fixture_variants() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("../../../../tests/desktop/timeline.json")).unwrap();
    assert!(!cases.is_empty());
    for case in &cases {
        let name = case["name"].as_str().unwrap();
        let song: Song = serde_json::from_value(case["input"].clone())
            .unwrap_or_else(|e| panic!("{name}: variant song must parse: {e}"));
        song.validate()
            .unwrap_or_else(|e| panic!("{name}: variant song must validate: {e}"));
        let ctx = |what: &str| format!("{name} {what}");
        assert_json(
            serde_json::to_value(song_core::bars(&song).unwrap()).unwrap(),
            &case["bars"],
            &ctx("bars"),
        );
        assert_json(
            serde_json::to_value(song_core::clicks(&song).unwrap()).unwrap(),
            &case["clicks"],
            &ctx("clicks"),
        );
        assert_json(
            serde_json::to_value(song_core::song_end(&song).unwrap()).unwrap(),
            &case["song"]["songEnd"],
            &ctx("songEnd"),
        );
        assert_json(
            Value::from(song_core::seconds_per_quarter(&song)),
            &case["song"]["secondsPerQuarter"],
            &ctx("secondsPerQuarter"),
        );
        let placements = song_core::placements(&song).unwrap();
        let mut segments = BTreeMap::new();
        let mut starts = BTreeMap::new();
        for placement in &placements {
            let key = format!(
                "{}:{}",
                placement.id,
                placement.appearance_id.as_deref().unwrap_or("global")
            );
            segments.insert(
                key.clone(),
                serde_json::to_value(song_core::segments(&song, placement).unwrap()).unwrap(),
            );
            starts.insert(
                key,
                serde_json::to_value(song_core::cycle_starts(&song, placement).unwrap()).unwrap(),
            );
        }
        for entry in case["segments"].as_array().unwrap() {
            let id = entry["id"].as_str().unwrap();
            assert_json(
                segments
                    .remove(id)
                    .unwrap_or_else(|| panic!("{name}: missing {id}")),
                &entry["segments"],
                &ctx(&format!("segments {id}")),
            );
        }
        assert!(segments.is_empty(), "{name}: extra placements");
        for entry in case["cycleStarts"].as_array().unwrap() {
            let id = entry["id"].as_str().unwrap();
            assert_json(
                starts
                    .remove(id)
                    .unwrap_or_else(|| panic!("{name}: missing {id}")),
                &entry["starts"],
                &ctx(&format!("cycleStarts {id}")),
            );
        }
        assert!(starts.is_empty(), "{name}: extra placements");
        assert_json(
            serde_json::to_value(song_core::rest_spans(&song).unwrap()).unwrap(),
            &case["restSpans"],
            &ctx("restSpans"),
        );
        let actual: Vec<Value> = serde_json::from_value(
            serde_json::to_value(song_core::sounds(&song).unwrap()).unwrap(),
        )
        .unwrap();
        let expected: Vec<Value> = serde_json::from_value(case["sounds"].clone()).unwrap();
        assert!(
            float_aware_eq(
                &Value::Array(canonical(actual)),
                &Value::Array(canonical(expected))
            ),
            "{name} sounds",
        );
        let until = song_core::song_end(&song).unwrap();
        match song_core::alignment(
            &song,
            &["lead1".to_string(), "lead2".to_string()],
            Time::ZERO,
            until,
        ) {
            Ok(found) => assert_json(
                serde_json::to_value(found).unwrap(),
                &case["song"]["alignment"],
                &ctx("alignment"),
            ),
            Err(error) => assert_eq!(
                error.message, case["song"]["alignmentError"],
                "{name} alignment",
            ),
        }
        for (ids, key) in [
            (vec!["lead1".to_string()], "singleAlignmentError"),
            (
                vec!["lead1".to_string(), "missing".to_string()],
                "unknownAlignmentError",
            ),
        ] {
            let error = song_core::alignment(&song, &ids, Time::ZERO, until).unwrap_err();
            assert_eq!(error.message, case["song"][key], "{name} {key}");
        }
    }
}
