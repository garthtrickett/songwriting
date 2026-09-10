use rusqlite::Connection;
use serde_json::{Value, json};
use song_core::{Action, Mutation, Song};
use song_workspace::Workspace;
use std::{
    io::Write,
    process::{Command, Stdio},
    sync::{Arc, Barrier},
};

fn fixture() -> Song {
    serde_json::from_str(include_str!("../../../../tests/desktop/fixture.json")).unwrap()
}
fn rename(operation: &str, revision: u64, title: &str) -> Mutation {
    Mutation {
        song_id: "desktop-fixture".into(),
        expected_revision: revision,
        operation_id: operation.into(),
        label: operation.into(),
        action: Action::Rename {
            title: title.into(),
        },
    }
}

#[test]
fn commit_survives_process_exit_before_reply_and_retry_is_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("workspace.sqlite");
    let request = rename("lost-reply", 0, "Durable edit");
    let mut child = Command::new(env!("CARGO_BIN_EXE_song-workspace"))
        .arg(&path)
        .arg("--exit-after-commit")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    writeln!(
        child.stdin.take().unwrap(),
        "{}",
        serde_json::to_string(&request).unwrap()
    )
    .unwrap();
    let output = child.wait_with_output().unwrap();
    assert_eq!(output.status.code(), Some(73));
    // Only initial state was delivered. The successful mutation had no reply.
    assert_eq!(String::from_utf8(output.stdout).unwrap().lines().count(), 1);
    let mut workspace = Workspace::open(&path).unwrap();
    assert_eq!(
        workspace
            .read("desktop-fixture")
            .unwrap()
            .song
            .unwrap()
            .title,
        "Durable edit"
    );
    assert_eq!(workspace.dispatch(&request).unwrap().revision, 1);
    assert_eq!(workspace.read("desktop-fixture").unwrap().history.len(), 1);
    let mut undo = rename("undo", 1, "unused");
    undo.action = Action::Undo {
        target_id: "lost-reply".into(),
    };
    assert_eq!(
        workspace.dispatch(&undo).unwrap().song.unwrap().title,
        "Mixed-meter sketch"
    );
    drop(workspace);
    assert_eq!(
        Workspace::open(&path)
            .unwrap()
            .read("desktop-fixture")
            .unwrap()
            .revision,
        2
    );
}

#[test]
fn failed_sqlite_write_never_publishes_state_or_an_operation_receipt() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("workspace.sqlite");
    let mut workspace = Workspace::open(&path).unwrap();
    workspace.initialize_fixture(fixture()).unwrap();
    let failure = Connection::open(&path).unwrap();
    failure.execute_batch("CREATE TRIGGER reject_write BEFORE UPDATE ON workspace BEGIN SELECT RAISE(ABORT, 'injected disk write failure'); END;").unwrap();
    let request = rename("retry-write", 0, "Saved later");
    assert_eq!(workspace.dispatch(&request).unwrap_err().code, "storage");
    let unchanged = workspace.read("desktop-fixture").unwrap();
    assert_eq!(unchanged.revision, 0);
    assert!(unchanged.history.is_empty());
    assert_eq!(unchanged.song.unwrap().title, "Mixed-meter sketch");
    failure.execute_batch("DROP TRIGGER reject_write;").unwrap();
    assert_eq!(workspace.dispatch(&request).unwrap().revision, 1);
}

#[test]
fn simultaneous_writers_cannot_overwrite_intervening_music() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("workspace.sqlite");
    Workspace::open(&path)
        .unwrap()
        .initialize_fixture(fixture())
        .unwrap();
    let mut left = Workspace::open(&path).unwrap();
    let mut right = Workspace::open(&path).unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let other = barrier.clone();
    let a = std::thread::spawn(move || {
        barrier.wait();
        left.dispatch(&rename("a", 0, "A"))
    });
    let b = std::thread::spawn(move || {
        other.wait();
        right.dispatch(&rename("b", 0, "B"))
    });
    let results = [a.join().unwrap(), b.join().unwrap()];
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(
        results.iter().find_map(|r| r.as_ref().err()).unwrap().code,
        "conflict"
    );
    assert_eq!(
        Workspace::open(&path)
            .unwrap()
            .read("desktop-fixture")
            .unwrap()
            .history
            .len(),
        1
    );
}

#[test]
fn corrupted_history_and_future_databases_are_rejected_without_repairing_them() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("workspace.sqlite");
    let mut workspace = Workspace::open(&path).unwrap();
    workspace.initialize_fixture(fixture()).unwrap();
    workspace.dispatch(&rename("rename", 0, "Changed")).unwrap();
    let mut envelope = serde_json::to_value(workspace.read("desktop-fixture").unwrap()).unwrap();
    envelope["history"][0]["deltas"][0]["after"] = json!("Forged history");
    let connection = Connection::open(&path).unwrap();
    connection
        .execute("UPDATE workspace SET envelope = ?1", [envelope.to_string()])
        .unwrap();
    assert!(workspace.read("desktop-fixture").is_err());
    let saved: String = connection
        .query_row("SELECT envelope FROM workspace", [], |r| r.get(0))
        .unwrap();
    assert_eq!(serde_json::from_str::<Value>(&saved).unwrap(), envelope);
    connection.pragma_update(None, "user_version", 100).unwrap();
    assert!(Workspace::open(&path).is_err());
    let version: i32 = connection
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, 100);
}

#[test]
fn initialization_does_not_replace_existing_music_or_claim_another_database() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("workspace.sqlite");
    let mut workspace = Workspace::open(&path).unwrap();
    workspace.initialize_fixture(fixture()).unwrap();
    workspace.dispatch(&rename("edit", 0, "Keep this")).unwrap();
    assert_eq!(
        workspace
            .initialize_fixture(fixture())
            .unwrap()
            .song
            .unwrap()
            .title,
        "Keep this"
    );
    let foreign = dir.path().join("foreign.sqlite");
    let c = Connection::open(&foreign).unwrap();
    c.execute_batch("CREATE TABLE other (value TEXT);").unwrap();
    assert!(Workspace::open(&foreign).is_err());
    assert_eq!(
        c.pragma_query_value(None, "application_id", |r| r.get::<_, i32>(0))
            .unwrap(),
        0
    );
}
