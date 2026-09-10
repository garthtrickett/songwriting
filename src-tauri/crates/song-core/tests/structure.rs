//! Differential structure commands against tests/desktop/structure.json.
//! repeat/move/remove/attach compare byte for byte; variation assigns copied
//! IDs in traversal order, which differs by map ordering, so it is checked
//! structurally instead.
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

fn accept(case: &serde_json::Value) -> Result<Song, String> {
    let song: Song = serde_json::from_value(case["song"].clone()).unwrap();
    // The TypeScript mutation nests the action under `command`; the Rust
    // mutation carries it flat.
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
    model
        .accept(&mutation, 100)
        .map(|next| next.song.expect("structure ops keep the song"))
        .map_err(|e| e.message)
}

#[test]
fn structure_commands_match_typescript() {
    let cases: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("../../../../tests/desktop/structure.json")).unwrap();
    assert!(!cases.is_empty());
    for case in &cases {
        let name = case["name"].as_str().unwrap();
        if name == "variation-ok" {
            continue;
        }
        match accept(case) {
            Ok(song) => {
                assert_eq!(case["ok"], true, "{name}");
                let actual = serde_json::to_value(song).unwrap();
                assert!(
                    float_aware_eq(&actual, &case["songAfter"]),
                    "{name}\nactual: {actual}\nexpected: {}",
                    case["songAfter"]
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
fn variation_copies_the_section_cohort_under_a_new_identity() {
    let cases: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("../../../../tests/desktop/structure.json")).unwrap();
    let case = cases.iter().find(|c| c["name"] == "variation-ok").unwrap();
    let input: Song = serde_json::from_value(case["song"].clone()).unwrap();
    let song = accept(case).unwrap_or_else(|e| panic!("variation must accept: {e}"));
    // Same order, repointed appearance, lined section copy.
    assert_eq!(song.arrangement_order, input.arrangement_order);
    let appearance = &song.tables.arrangement["verse1"];
    assert_eq!(appearance.section_id, "v2");
    assert_eq!(appearance.name, "Again");
    let section = &song.tables.sections["v2"];
    assert_eq!(section.source_id.as_deref(), Some("verse"));
    assert_eq!(
        section.bar_ids.len(),
        input.tables.sections["verse"].bar_ids.len()
    );
    assert_eq!(
        input.tables.sections["verse"].bar_ids,
        song.tables.sections["verse"].bar_ids
    );
    // Every copied id is fresh and namespaced; originals are untouched.
    let before: std::collections::BTreeSet<String> = input
        .tables
        .patterns
        .keys()
        .chain(input.tables.events.keys())
        .chain(input.tables.chords.keys())
        .chain(input.tables.bars.keys())
        .chain(input.tables.occurrences.keys())
        .cloned()
        .collect();
    for id in song.tables.patterns.keys().chain(song.tables.events.keys()) {
        if id.starts_with("v2-") {
            assert!(!before.contains(id), "copied id collides: {id}");
        }
    }
    assert_eq!(song.tables.patterns.len(), input.tables.patterns.len() + 1);
    assert_eq!(song.tables.events.len(), input.tables.events.len() + 2);
    let pattern = song
        .tables
        .patterns
        .values()
        .find(|p| p.source_id.is_some())
        .unwrap();
    assert_eq!(pattern.source_id.as_deref(), Some("riff"));
    for occurrence in song
        .tables
        .occurrences
        .values()
        .filter(|o| o.id.starts_with("v2-"))
    {
        assert_eq!(occurrence.section_id.as_deref(), Some("v2"));
        assert!(song.tables.patterns.contains_key(&occurrence.pattern_id));
    }
    for bar in song.tables.bars.values().filter(|b| b.section_id == "v2") {
        assert_eq!(bar.section_id, "v2");
    }
    assert_eq!(song.tables.parts, input.tables.parts);
    assert_eq!(song.tables.voices, input.tables.voices);
}

#[test]
fn undo_reverses_table_deltas_and_restores_the_input_song() {
    let cases: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("../../../../tests/desktop/structure.json")).unwrap();
    let case = cases.iter().find(|c| c["name"] == "repeat-ok").unwrap();
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
    let model = Envelope::fixture(song.clone()).unwrap();
    let applied = model.accept(&mutation, 100).unwrap();
    assert!(applied.history[0].deltas.iter().any(|d| matches!(
        d,
        song_core::Delta::Table { table, .. } if table == "arrangement" || table == "meta"
    )));
    let undo = Mutation {
        song_id: wire["songId"].as_str().unwrap().into(),
        expected_revision: 1,
        operation_id: "undo-repeat".into(),
        label: "Undo".into(),
        action: song_core::Action::Undo {
            target_id: "op".into(),
        },
    };
    let undone = applied.accept(&undo, 101).unwrap();
    assert_eq!(undone.song, Some(song));
    undone.validate().unwrap();
}
