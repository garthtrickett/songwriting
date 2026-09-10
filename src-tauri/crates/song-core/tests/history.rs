//! Differential undo/redo stacks against tests/desktop/history.json, one entry
//! per command step of the shared fixture run.
use song_core::{StackEntry, history_stacks};

#[test]
fn undo_redo_stacks_match_typescript_at_every_command_step() {
    let steps: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("../../../../tests/desktop/history.json")).unwrap();
    assert!(!steps.is_empty());
    for step in &steps {
        let index = step["step"].as_u64().unwrap();
        let entries: Vec<StackEntry> = step["receipts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| StackEntry {
                operation_id: r["operationId"].as_str().unwrap().into(),
                undo_of: r["undoOf"].as_str().map(str::to_string),
                has_deltas: r["deltaCount"].as_u64().unwrap() > 0,
                deletion_unchanged: r["beforeDeleted"] == r["afterDeleted"],
            })
            .collect();
        let (undo, redo) = history_stacks(&entries);
        assert_eq!(
            undo,
            step["undo"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().to_string())
                .collect::<Vec<_>>(),
            "step {index} undo",
        );
        assert_eq!(
            redo,
            step["redo"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().to_string())
                .collect::<Vec<_>>(),
            "step {index} redo",
        );
    }
}

#[test]
fn state_redoable_tracks_undone_operations() {
    use song_core::{Action, Envelope, Mutation, Song};
    let song: Song =
        serde_json::from_str(include_str!("../../../../tests/desktop/fixture.json")).unwrap();
    let model = Envelope::fixture(song).unwrap();
    assert!(model.state().redoable.is_empty());
    let rename = |revision: u64, id: &str, title: &str| Mutation {
        song_id: "desktop-fixture".into(),
        expected_revision: revision,
        operation_id: id.into(),
        label: id.into(),
        action: Action::Rename {
            title: title.into(),
        },
    };
    let undo = |revision: u64, id: &str, target: &str| Mutation {
        song_id: "desktop-fixture".into(),
        expected_revision: revision,
        operation_id: id.into(),
        label: id.into(),
        action: Action::Undo {
            target_id: target.into(),
        },
    };
    let one = model.accept(&rename(0, "a", "First"), 1).unwrap();
    assert_eq!(one.state().undoable, ["a"]);
    assert!(one.state().redoable.is_empty());
    let two = one.accept(&undo(1, "b", "a"), 2).unwrap();
    assert!(two.state().undoable.is_empty());
    assert_eq!(two.state().redoable, ["b"]);
    let three = two.accept(&undo(2, "c", "b"), 3).unwrap();
    assert_eq!(three.state().undoable, ["c"]);
    assert!(three.state().redoable.is_empty());
    assert_eq!(three.song.as_ref().unwrap().title, "First");
}
