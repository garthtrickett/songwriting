//! Differential note edits against tests/desktop/edit.json: pitch/start/
//! duration changes, member removal, note combination and the generic edit
//! path, through helper parity plus applyCommand parity.
use song_core::{Envelope, Mutation, Song, change_notes, combine_notes, remove_notes};

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

fn song_of(case: &serde_json::Value) -> Song {
    serde_json::from_value(case["song"].clone()).unwrap()
}

#[test]
fn note_helpers_match_typescript_changes() {
    let cases: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("../../../../tests/desktop/edit.json")).unwrap();
    assert!(!cases.is_empty());
    for case in cases.iter().filter(|c| c["helper"] != "edit") {
        let name = case["name"].as_str().unwrap();
        let song = song_of(case);
        let result = match case["helper"].as_str().unwrap() {
            "change" => {
                let edits: Vec<song_core::NoteEdit> =
                    serde_json::from_value(case["args"].clone()).unwrap();
                change_notes(&song, &edits)
                    .map(|changes| serde_json::to_value(changes).unwrap())
                    .map_err(|e| e.message)
            }
            "remove" => {
                let targets: Vec<song_core::NoteTarget> =
                    serde_json::from_value(case["args"].clone()).unwrap();
                remove_notes(&song, &targets)
                    .map(|changes| serde_json::to_value(changes).unwrap())
                    .map_err(|e| e.message)
            }
            "combine" => {
                let chord_id = case["args"]["chordId"].as_str().unwrap();
                let event_id = case["args"]["eventId"].as_str().unwrap();
                let targets: Vec<song_core::NoteTarget> =
                    serde_json::from_value(case["args"]["targets"].clone()).unwrap();
                combine_notes(&song, &targets, chord_id, event_id)
                    .map(|changes| serde_json::to_value(changes).unwrap())
                    .map_err(|e| e.message)
            }
            other => panic!("{name}: unknown helper {other}"),
        };
        match result {
            Ok(changes) => {
                assert_eq!(case["ok"], true, "{name}");
                assert!(
                    float_aware_eq(&changes, &case["changes"]),
                    "{name}\nactual: {changes}\nexpected: {}",
                    case["changes"]
                );
            }
            Err(message) => {
                assert_eq!(case["ok"], false, "{name}");
                assert_eq!(message, case["error"], "{name}");
            }
        }
    }
}

#[test]
fn generic_edits_apply_through_accept() {
    let cases: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("../../../../tests/desktop/edit.json")).unwrap();
    for case in &cases {
        let name = case["name"].as_str().unwrap();
        // Helper-error cases have no changes; the helper test covers them.
        // Raw edit errors apply their args directly.
        let changes_value = match case["helper"].as_str().unwrap() {
            "edit" => &case["args"],
            _ => match case.get("changes") {
                Some(changes) => changes,
                None => continue,
            },
        };
        let song = song_of(case);
        let changes: Vec<song_core::WireChange> =
            serde_json::from_value(changes_value.clone()).unwrap();
        let mutation = Mutation {
            song_id: song.id.clone(),
            expected_revision: 0,
            operation_id: "op".into(),
            label: "op".into(),
            action: song_core::Action::Edit { changes },
        };
        let model = Envelope::fixture(song).unwrap();
        match model.accept(&mutation, 100) {
            Ok(next) => {
                assert_eq!(case["ok"], true, "{name}");
                next.validate().unwrap();
                let actual = serde_json::to_value(&next.song).unwrap();
                assert!(
                    float_aware_eq(&actual, &case["songAfter"]),
                    "{name}\nactual: {actual}\nexpected: {}",
                    case["songAfter"]
                );
            }
            Err(error) => {
                assert_eq!(case["ok"], false, "{name}");
                assert_eq!(error.message, case["error"], "{name}");
            }
        }
    }
}
