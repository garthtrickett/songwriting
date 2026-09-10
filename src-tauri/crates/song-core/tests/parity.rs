use serde_json::{Value, json};
use song_core::{AudioAsset, Envelope, MAX_SAFE_INTEGER, Mutation, Song, Time};

fn fixture() -> Song {
    serde_json::from_str(include_str!("../../../../tests/desktop/fixture.json")).unwrap()
}

#[test]
fn command_sequences_match_existing_typescript_including_rejections_and_undo() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("../../../../tests/desktop/commands.json")).unwrap();
    let mut model = Envelope::fixture(fixture()).unwrap();
    let mut expected = serde_json::to_value(fixture()).unwrap();
    for (i, case) in cases.iter().enumerate() {
        let request: Mutation = serde_json::from_value(case["request"].clone()).unwrap();
        match model.accept(&request, i as u64) {
            Ok(next) => {
                assert_eq!(case["ok"], true, "case {i}");
                model = next;
            }
            Err(error) => {
                assert_eq!(case["ok"], false, "case {i}: {error}");
                assert_eq!(case["error"], error.message, "case {i}");
            }
        }
        for delta in case["changes"].as_array().unwrap() {
            let table = delta["table"].as_str().unwrap();
            let id = delta["id"].as_str().unwrap();
            let slot = if table == "meta" {
                &mut expected[id]
            } else {
                &mut expected["tables"][table][id]
            };
            assert_eq!(*slot, delta["before"], "reference delta at case {i}");
            *slot = delta["after"].clone();
        }
        assert_eq!(
            model.song,
            Some(serde_json::from_value::<Song>(expected.clone()).unwrap()),
            "case {i}"
        );
        assert_eq!(json!(model.revision), case["revision"], "case {i}");
        model.validate().unwrap();
    }
}

#[test]
fn exact_arithmetic_matches_typescript_at_safe_integer_boundaries() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("../../../../tests/desktop/time.json")).unwrap();
    for case in cases {
        let a: Time = serde_json::from_value(case["a"].clone()).unwrap();
        let b: Time = serde_json::from_value(case["b"].clone()).unwrap();
        if case["operation"] == "value" {
            // Floats have no integer spelling in JSON; compare numerically.
            assert_eq!(case["result"].as_f64(), Some(a.value()), "{case}");
            continue;
        }
        let result = match case["operation"].as_str().unwrap() {
            "add" => a.checked_add(b).map(|v| json!(v)),
            "sub" => a.checked_sub(b).map(|v| json!(v)),
            "mul" => a.checked_mul(b).map(|v| json!(v)),
            "cmp" => Ok(json!(match a.cmp(&b) {
                std::cmp::Ordering::Less => -1,
                std::cmp::Ordering::Equal => 0,
                std::cmp::Ordering::Greater => 1,
            })),
            "modulo" => a.checked_modulo(b).map(|v| json!(v)),
            _ => unreachable!(),
        };
        match result {
            Ok(value) => assert_eq!(value, case["result"], "{case}"),
            Err(error) => assert_eq!(error.message, case["error"], "{case}"),
        }
    }
}

#[test]
fn wire_time_is_normalized_bounded_and_never_silently_rounded() {
    for bad in [
        json!([2, 6]),
        json!([1, 0]),
        json!([1, -1]),
        json!([1.5, 2]),
        json!([MAX_SAFE_INTEGER + 1, 1]),
        json!([0, 2]),
    ] {
        assert!(serde_json::from_value::<Time>(bad).is_err());
    }
    assert_eq!(Time::new(2, 6).unwrap(), Time::new(1, 3).unwrap());
    assert!(Time::new(i64::MIN, 1).is_err());
}

#[test]
fn malformed_music_and_unported_features_are_rejected_without_dropping_data() {
    let mut s = fixture();
    s.tables.chords.get_mut("chord").unwrap().notes.clear();
    assert_eq!(
        s.validate().unwrap_err().message,
        "Chord must contain 1–64 notes"
    );
    let mut s = fixture();
    s.tables.bars.get_mut("seven").unwrap().groups = vec![4, 4];
    assert_eq!(
        s.validate().unwrap_err().message,
        "Beat groups must sum to numerator"
    );
    let mut s = fixture();
    s.tables.events.get_mut("note").unwrap().pitch.degree = 8;
    assert_eq!(s.validate().unwrap_err().message, "Invalid relative pitch");
    let mut s = fixture();
    s.tables.voices.get_mut("lead").unwrap().part_id = "missing".into();
    assert!(s.validate().is_err());
    let mut s = fixture();
    s.tables.assets.insert(
        "recording".into(),
        AudioAsset {
            id: "recording".into(),
            name: "Recording".into(),
            mime: "audio/wav".into(),
            bytes: 8,
            duration: 1.0,
        },
    );
    assert_eq!(s.validate().unwrap_err().code, "unsupported");
    let mut wire = serde_json::to_value(fixture()).unwrap();
    wire["tables"]["events"]["note"]["unexpected"] = json!(true);
    assert!(serde_json::from_value::<Song>(wire).is_err());
}

#[test]
fn clients_cannot_mutate_canonical_state_through_a_render_snapshot() {
    let model = Envelope::fixture(fixture()).unwrap();
    let mut view = model.state();
    view.song.as_mut().unwrap().title = "Only a local preview".into();
    assert_eq!(model.song.as_ref().unwrap().title, "Mixed-meter sketch");
    let mut wire = json!({"songId": "desktop-fixture", "operationId": "op", "expectedRevision": 0,
        "label": "op", "action": {"kind": "rename", "title": "Hi"}});
    wire["acceptedSong"] = json!({});
    assert!(serde_json::from_value::<Mutation>(wire).is_err());
}
