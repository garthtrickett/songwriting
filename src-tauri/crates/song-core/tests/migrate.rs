//! Differential migration and envelope import against
//! tests/desktop/migrate.json and tests/desktop/import.json.
use song_core::{Envelope, Song};

#[test]
fn migration_matches_typescript_additive_defaults() {
    let cases: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("../../../../tests/desktop/migrate.json")).unwrap();
    assert!(!cases.is_empty());
    for case in &cases {
        let name = case["name"].as_str().unwrap();
        let actual = if let Some(table) = case.get("table").and_then(|t| t.as_str()) {
            song_core::migrate_entity(table, &case["input"])
        } else {
            song_core::migrate_song(&case["input"])
        };
        assert_eq!(actual, case["output"], "{name}");
    }
}

#[test]
fn browser_envelope_imports_with_replayed_history() {
    let envelope: serde_json::Value =
        serde_json::from_str(include_str!("../../../../tests/desktop/import.json")).unwrap();
    let imported = Envelope::import(&envelope).unwrap();
    assert_eq!(imported.revision, 3);
    assert_eq!(imported.song.as_ref().unwrap().title, "Imported");
    assert_eq!(imported.history.len(), 3);
    let remove = &imported.history[1];
    assert_eq!(remove.operation_id, "remove");
    assert!(!remove.before_deleted && remove.after_deleted);
    let deleted = remove.deleted_song.as_ref().unwrap();
    assert_eq!(deleted.title, "Imported");
    let restore = &imported.history[2];
    assert_eq!(restore.operation_id, "restore");
    assert!(restore.before_deleted && !restore.after_deleted);
    // Imported envelopes revalidate, including replay equality.
    imported.validate().unwrap();
}

#[test]
fn corrupt_envelopes_fail_with_musical_errors() {
    let mut envelope: serde_json::Value =
        serde_json::from_str(include_str!("../../../../tests/desktop/import.json")).unwrap();
    // Schema 8 passes migration through and fails song validation.
    envelope["song"]["schemaVersion"] = serde_json::json!(8);
    assert_eq!(
        Envelope::import(&envelope).unwrap_err().message,
        "Unsupported song schema version"
    );
    let mut envelope: serde_json::Value =
        serde_json::from_str(include_str!("../../../../tests/desktop/import.json")).unwrap();
    envelope["history"][0]["fingerprint"] = serde_json::json!("{broken");
    assert_eq!(
        Envelope::import(&envelope).unwrap_err().message,
        "Stored receipt cannot be replayed: fingerprint"
    );
    let mut envelope: serde_json::Value =
        serde_json::from_str(include_str!("../../../../tests/desktop/import.json")).unwrap();
    envelope["song"] = serde_json::Value::Null;
    assert_eq!(
        Envelope::import(&envelope).unwrap_err().message,
        "Imported song is missing"
    );
    let mut envelope: serde_json::Value =
        serde_json::from_str(include_str!("../../../../tests/desktop/import.json")).unwrap();
    envelope["id"] = serde_json::json!("other-song");
    assert_eq!(
        Envelope::import(&envelope).unwrap_err().message,
        "Stored envelope identity mismatch"
    );
    // A missing song document is not an importable envelope.
    let song: Song =
        serde_json::from_str(include_str!("../../../../tests/desktop/fixture.json")).unwrap();
    assert!(Envelope::import(&serde_json::to_value(&song).unwrap()).is_err());
}
