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
