//! Differential harmony commands against tests/desktop/harmony.json: chord
//! building, transposition, voice leading, member performance and expression
//! ramps through applyCommand parity.
use song_core::{Envelope, Mutation, Song};

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

#[test]
fn harmony_commands_match_typescript() {
    let cases: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("../../../../tests/desktop/harmony.json")).unwrap();
    assert!(!cases.is_empty());
    for case in &cases {
        let name = case["name"].as_str().unwrap();
        let song: Song = serde_json::from_value(case["song"].clone()).unwrap();
        let wire = &case["mutation"];
        let mutation: Mutation = serde_json::from_value(serde_json::json!({
            "songId": wire["songId"],
            "expectedRevision": wire["expectedRevision"],
            "operationId": wire["operationId"],
            "label": wire["label"],
            "action": wire["command"],
        }))
        .unwrap();
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
