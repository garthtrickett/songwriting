//! Schema migration for songs stored by older writers. Mirrors migrate.ts:
//! additive defaults upgrade mixed-version entities without erasing lineage.
//! Anything migration does not recognize passes through for validation to
//! reject with a musical error instead of a migration error.
use serde_json::Value;

/// Migrate one table entity; non-records pass through untouched.
pub fn migrate_entity(table: &str, value: &Value) -> Value {
    let Some(_) = value.as_object() else {
        return value.clone();
    };
    let mut entity = value.clone();
    let map = entity.as_object_mut().unwrap();
    match table {
        "chords" => {
            map.entry("labelTonic")
                .or_insert(serde_json::json!({"degree": 1, "alteration": 0, "octave": 0}));
        }
        "sections" => {
            map.entry("sourceId").or_insert(Value::Null);
        }
        "occurrences" => {
            map.entry("sectionId").or_insert(Value::Null);
        }
        "patterns" => {
            map.entry("groups").or_insert(Value::Array(vec![]));
        }
        "events" => {
            let id = map.get("id").cloned().unwrap_or(Value::Null);
            map.entry("originId").or_insert(id);
        }
        _ => {}
    }
    Value::Object(map.clone())
}

/// Migrate a stored song to schema 7. Inputs outside schemas 1–6, without a
/// tables record, or that are not records pass through for validation.
pub fn migrate_song(input: &Value) -> Value {
    let Some(song) = input.as_object() else {
        return input.clone();
    };
    let version_ok = song
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .is_some_and(|v| (1..=6).contains(&v));
    if !version_ok || !song.get("tables").is_some_and(|t| t.is_object()) {
        return input.clone();
    }
    let mut song = input.clone();
    let root = song.as_object_mut().unwrap();
    root.insert("schemaVersion".into(), Value::from(7));
    if root.get("writing").is_none_or(Value::is_null) {
        root.insert(
            "writing".into(),
            serde_json::json!({"instructions": "", "preferences": ""}),
        );
    }
    for table in [
        "prompts",
        "phrases",
        "lyrics",
        "polyrhythms",
        "harmony",
        "assets",
        "takes",
        "fretted",
        "fingerings",
    ] {
        let tables = root.get_mut("tables").unwrap().as_object_mut().unwrap();
        if tables.get(table).is_none_or(Value::is_null) {
            tables.insert(table.into(), Value::Object(Default::default()));
        }
    }
    for table in ["sections", "occurrences", "patterns", "events", "chords"] {
        let tables = root.get("tables").unwrap().as_object().unwrap().clone();
        if let Some(entries) = tables.get(table).and_then(Value::as_object) {
            let migrated: serde_json::Map<String, Value> = entries
                .iter()
                .map(|(id, entity)| (id.clone(), migrate_entity(table, entity)))
                .collect();
            root.get_mut("tables").unwrap().as_object_mut().unwrap()[table] =
                Value::Object(migrated);
        }
    }
    song
}
