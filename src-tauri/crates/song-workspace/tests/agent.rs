use rusqlite::Connection;
use serde_json::json;
use song_core::{Action, Mutation};
use song_workspace::{
    Workspace,
    agent::{Checkpoint, Status, ToolCall},
};

#[test]
fn task_result_failure_rolls_back_music_and_retry_is_exactly_once() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("w.sqlite");
    let mut w = Workspace::open(&path).unwrap();
    w.initialize_fixture(
        serde_json::from_str(include_str!("../../../../tests/desktop/fixture.json")).unwrap(),
    )
    .unwrap();
    let t = w
        .agent_begin("task".into(), "Rename".into(), "test:model".into())
        .unwrap();
    w.agent_checkpoint(
        &t.id,
        t.generation,
        Checkpoint {
            rounds: 1,
            messages: vec![],
            calls: vec![ToolCall {
                id: "call".into(),
                name: "edit_song".into(),
                arguments: json!({"expectedRevision":0,"action":{"kind":"rename","title":"Saved"}}),
                result: None,
            }],
        },
    )
    .unwrap();
    let c = Connection::open(&path).unwrap();
    c.execute_batch("CREATE TRIGGER fail_result BEFORE UPDATE ON agent_tasks BEGIN SELECT RAISE(ABORT, 'task disk failure'); END;").unwrap();
    assert_eq!(
        w.agent_tool(&t.id, t.generation, 0).unwrap_err().code,
        "storage"
    );
    assert_eq!(w.read("desktop-fixture").unwrap().revision, 0);
    assert!(
        w.agent_task().unwrap().unwrap().checkpoint.calls[0]
            .result
            .is_none()
    );
    c.execute_batch("DROP TRIGGER fail_result;").unwrap();
    let saved = w.agent_tool(&t.id, t.generation, 0).unwrap();
    let result = saved.checkpoint.calls[0].result.clone();
    assert_eq!(
        w.agent_tool(&t.id, t.generation, 0)
            .unwrap()
            .checkpoint
            .calls[0]
            .result,
        result
    );
    let e = w.read("desktop-fixture").unwrap();
    assert_eq!(e.history.len(), 1);
    w.dispatch(&Mutation {
        song_id: e.song.as_ref().unwrap().id.clone(),
        expected_revision: 1,
        operation_id: "undo".into(),
        label: "Undo agent".into(),
        action: Action::Undo {
            target_id: e.history[0].operation_id.clone(),
        },
    })
    .unwrap();
    assert_eq!(
        w.read("desktop-fixture").unwrap().song.unwrap().title,
        "Mixed-meter sketch"
    );
    assert_eq!(
        w.agent_tool(&t.id, t.generation, 0)
            .unwrap()
            .checkpoint
            .calls[0]
            .result,
        result
    );
    assert_eq!(w.read("desktop-fixture").unwrap().revision, 2);
    w.agent_control(&t.id, Status::Cancelled, "Cancel".into())
        .unwrap();
    assert_eq!(
        w.agent_tool(&t.id, t.generation, 0).unwrap_err().code,
        "cancelled"
    );
}

#[test]
fn stale_revision_and_unsupported_tools_are_durable_errors_without_edits() {
    let dir = tempfile::tempdir().unwrap();
    let mut w = Workspace::open(dir.path().join("w.sqlite")).unwrap();
    w.initialize_fixture(
        serde_json::from_str(include_str!("../../../../tests/desktop/fixture.json")).unwrap(),
    )
    .unwrap();
    let t = w
        .agent_begin("task".into(), "Rename".into(), "test:model".into())
        .unwrap();
    let calls = vec![
        ToolCall {
            id: "a".into(),
            name: "edit_song".into(),
            arguments: json!({"expectedRevision":12,"action":{"kind":"rename","title":"stale"}}),
            result: None,
        },
        ToolCall {
            id: "b".into(),
            name: "shell".into(),
            arguments: json!({}),
            result: None,
        },
    ];
    w.agent_checkpoint(
        &t.id,
        t.generation,
        Checkpoint {
            rounds: 1,
            messages: vec![],
            calls,
        },
    )
    .unwrap();
    assert_eq!(
        w.agent_tool(&t.id, t.generation, 1).unwrap_err().code,
        "invalid"
    );
    assert_eq!(
        w.agent_tool(&t.id, t.generation, 0)
            .unwrap()
            .checkpoint
            .calls[0]
            .result
            .as_ref()
            .unwrap()["error"]["code"],
        "conflict"
    );
    assert_eq!(
        w.agent_tool(&t.id, t.generation, 1)
            .unwrap()
            .checkpoint
            .calls[1]
            .result
            .as_ref()
            .unwrap()["error"]["code"],
        "unsupported"
    );
    assert_eq!(w.read("desktop-fixture").unwrap().revision, 0);
}

#[test]
fn v1_database_migrates_transactionally_without_replacing_music() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("old.sqlite");
    {
        let mut w = Workspace::open(&path).unwrap();
        w.initialize_fixture(
            serde_json::from_str(include_str!("../../../../tests/desktop/fixture.json")).unwrap(),
        )
        .unwrap();
        w.dispatch(&Mutation {
            song_id: "desktop-fixture".into(),
            expected_revision: 0,
            operation_id: "old".into(),
            label: "Old saved title".into(),
            action: Action::Rename {
                title: "Keep old music".into(),
            },
        })
        .unwrap();
    }
    let c = Connection::open(&path).unwrap();
    c.execute_batch("DROP TABLE agent_tasks; PRAGMA user_version=1;")
        .unwrap();
    drop(c);
    let w = Workspace::open(&path).unwrap();
    assert_eq!(
        w.read("desktop-fixture").unwrap().song.unwrap().title,
        "Keep old music"
    );
    assert_eq!(w.read("desktop-fixture").unwrap().history.len(), 1);
    assert!(w.agent_task().unwrap().is_none());
}
