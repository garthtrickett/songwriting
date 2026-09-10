//! Workspace import and storage failure drills: idempotent imports,
//! conflicting content, corrupt envelopes, unreadable databases, read-only
//! directories and failed migrations.
use rusqlite::Connection;
use serde_json::{Value, json};
use song_core::{Action, Mutation};
use song_workspace::Workspace;

fn import_fixture() -> Value {
    serde_json::from_str(include_str!("../../../../tests/desktop/import.json")).unwrap()
}

fn workspace(dir: &tempfile::TempDir) -> Workspace {
    Workspace::open(dir.path().join("workspace.sqlite")).unwrap()
}

#[test]
fn duplicate_imports_are_idempotent_and_conflicts_stay_explicit() {
    let dir = tempfile::tempdir().unwrap();
    let mut workspace = workspace(&dir);
    let envelope = import_fixture();
    let first = workspace.import_envelope(&envelope).unwrap();
    assert_eq!(first.revision, 3);
    let second = workspace.import_envelope(&envelope).unwrap();
    assert_eq!(second.revision, 3);
    let rows: i64 = Connection::open(dir.path().join("workspace.sqlite"))
        .unwrap()
        .query_row("SELECT count(*) FROM workspace", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rows, 1);
    // Same song id with different content must not merge silently.
    workspace
        .dispatch(&Mutation {
            song_id: "desktop-fixture".into(),
            expected_revision: 3,
            operation_id: "rename-again".into(),
            label: "rename-again".into(),
            action: Action::Rename {
                title: "Changed".into(),
            },
        })
        .unwrap();
    assert_eq!(
        workspace.import_envelope(&envelope).unwrap_err().code,
        "conflict"
    );
}

#[test]
fn corrupt_envelopes_and_foreign_databases_fail_cleanly() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("workspace.sqlite");
    let mut workspace = Workspace::open(&path).unwrap();
    workspace.import_envelope(&import_fixture()).unwrap();
    drop(workspace);
    Connection::open(&path)
        .unwrap()
        .execute(
            "UPDATE workspace SET envelope = 'not json' WHERE id = 'desktop-fixture'",
            [],
        )
        .unwrap();
    let error = Workspace::open(&path)
        .unwrap()
        .read("desktop-fixture")
        .unwrap_err();
    assert_eq!(error.code, "storage");
    // A database from another application is never adopted.
    let foreign = dir.path().join("foreign.sqlite");
    Connection::open(&foreign)
        .unwrap()
        .execute_batch("PRAGMA application_id = 1234; PRAGMA user_version = 1;")
        .unwrap();
    assert_eq!(
        Workspace::open(&foreign)
            .map(|_| ())
            .map_err(|e| e.code)
            .unwrap_err(),
        "storage"
    );
    // Unknown future versions are rejected rather than migrated blindly.
    let future = dir.path().join("future.sqlite");
    Connection::open(&future)
        .unwrap()
        .execute_batch("PRAGMA application_id = 0x53574431; PRAGMA user_version = 99;")
        .unwrap();
    assert_eq!(
        Workspace::open(&future)
            .map(|_| ())
            .map_err(|e| e.code)
            .unwrap_err(),
        "storage"
    );
}

#[test]
fn import_rejects_deleted_and_mismatched_envelopes() {
    let dir = tempfile::tempdir().unwrap();
    let mut workspace = workspace(&dir);
    let mut envelope = import_fixture();
    envelope["song"] = Value::Null;
    assert_eq!(
        workspace.import_envelope(&envelope).unwrap_err().code,
        "invalid"
    );
    let mut envelope = import_fixture();
    envelope["id"] = json!("other-song");
    assert_eq!(
        workspace.import_envelope(&envelope).unwrap_err().code,
        "invalid"
    );
}

#[cfg(unix)]
#[test]
fn read_only_directories_fail_storage_not_silence() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("workspace.sqlite");
    let mut workspace = Workspace::open(&path).unwrap();
    workspace.import_envelope(&import_fixture()).unwrap();
    drop(workspace);
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o555)).unwrap();
    assert_eq!(
        Workspace::open(&path)
            .map(|_| ())
            .map_err(|e| e.code)
            .unwrap_err(),
        "storage"
    );
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
    // The committed import survives the failed open.
    let workspace = Workspace::open(&path).unwrap();
    assert_eq!(workspace.read("desktop-fixture").unwrap().revision, 3);
}

#[test]
fn failed_writes_leave_committed_history_intact() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("workspace.sqlite");
    let mut workspace = Workspace::open(&path).unwrap();
    workspace.import_envelope(&import_fixture()).unwrap();
    // Hold an exclusive lock from a second connection: the dispatch commit
    // must fail loudly after the busy timeout instead of hanging or tearing.
    let holder = Connection::open(&path).unwrap();
    holder.execute_batch("BEGIN EXCLUSIVE;").unwrap();
    let error = workspace
        .dispatch(&Mutation {
            song_id: "desktop-fixture".into(),
            expected_revision: 3,
            operation_id: "rename-again".into(),
            label: "rename-again".into(),
            action: Action::Rename {
                title: "Changed".into(),
            },
        })
        .map(|_| ())
        .map_err(|e| e.code)
        .unwrap_err();
    assert_eq!(error, "storage");
    holder.execute_batch("ROLLBACK;").unwrap();
    drop(holder);
    let state = workspace
        .dispatch(&Mutation {
            song_id: "desktop-fixture".into(),
            expected_revision: 3,
            operation_id: "rename-again".into(),
            label: "rename-again".into(),
            action: Action::Rename {
                title: "Changed".into(),
            },
        })
        .unwrap();
    assert_eq!(state.revision, 4);
    assert_eq!(workspace.read("desktop-fixture").unwrap().revision, 4);
}
