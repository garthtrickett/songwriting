use song_core::{Action, Time};
use song_session::{
    Session,
    protocol::{EditRequest, PROTOCOL},
};
use std::sync::{Arc, Mutex};

#[tokio::test]
async fn worker_projects_exact_music_and_rejects_old_sessions_without_losing_saved_changes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("profile/workspace.sqlite");
    let events = Arc::new(Mutex::new(vec![]));
    let capture = events.clone();
    let session = Session::start(path.clone(), move |s| capture.lock().unwrap().push(s));
    let initial = session.read().await.unwrap();
    assert_eq!(
        initial
            .bars
            .iter()
            .map(|b| b.label.as_str())
            .collect::<Vec<_>>(),
        ["7/8", "5/4"]
    );
    assert_eq!(initial.notes.len(), 4);
    assert_eq!(initial.placements[0].voice, "Lead");
    let request = EditRequest {
        protocol: PROTOCOL,
        epoch: initial.epoch.clone(),
        expected_revision: 0,
        operation_id: "move-root".into(),
        label: "Move root".into(),
        action: Action::MoveNote {
            event_id: "harmony".into(),
            member_id: Some("root".into()),
            start: Time::new(1, 3).unwrap(),
        },
    };
    let edited = session.dispatch(request.clone()).await.unwrap();
    assert_eq!(
        edited
            .notes
            .iter()
            .find(|n| n.member_id.as_deref() == Some("root"))
            .unwrap()
            .start,
        Time::new(1, 3).unwrap()
    );
    assert_eq!(
        edited
            .notes
            .iter()
            .find(|n| n.member_id.as_deref() == Some("third"))
            .unwrap()
            .start,
        Time::new(1, 1).unwrap()
    );
    assert_eq!(events.lock().unwrap().last().unwrap().revision, 1);
    assert_eq!(session.dispatch(request.clone()).await.unwrap().revision, 1);
    let mut invalid = request.clone();
    invalid.protocol = 2;
    assert_eq!(
        session.dispatch(invalid).await.unwrap_err().code,
        "protocol"
    );
    session.close();
    assert_eq!(session.read().await.unwrap_err().code, "closing");
    let reopened = Session::start(path, |_| {});
    let restored = reopened.read().await.unwrap();
    assert_ne!(restored.epoch, initial.epoch);
    assert_eq!(restored.revision, 1);
    assert_eq!(
        reopened.dispatch(request).await.unwrap_err().code,
        "session"
    );
    let undo = EditRequest {
        protocol: PROTOCOL,
        epoch: restored.epoch,
        expected_revision: 1,
        operation_id: "undo".into(),
        label: "Undo move".into(),
        action: Action::Undo {
            target_id: "move-root".into(),
        },
    };
    assert_eq!(
        reopened
            .dispatch(undo)
            .await
            .unwrap()
            .notes
            .iter()
            .find(|n| n.member_id.as_deref() == Some("root"))
            .unwrap()
            .start,
        Time::new(1, 1).unwrap()
    );
    reopened.close();
}

#[tokio::test]
async fn startup_failure_is_reported_and_never_replaces_the_unreadable_database() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("workspace.sqlite");
    std::fs::write(&path, "not a database").unwrap();
    let session = Session::start(path.clone(), |_| panic!("No saved event expected"));
    assert_eq!(session.read().await.unwrap_err().code, "storage");
    assert_eq!(std::fs::read_to_string(path).unwrap(), "not a database");
    session.close();
}

#[tokio::test]
async fn shutdown_drains_accepted_edits_even_when_the_first_renderer_disappears() {
    use std::{future::Future, task::Poll};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("workspace.sqlite");
    let (committed, committed_rx) = std::sync::mpsc::channel();
    let (release, release_rx) = std::sync::mpsc::channel();
    let session = Session::start(path.clone(), move |state| {
        if state.revision == 1 {
            committed.send(()).unwrap();
            release_rx.recv().unwrap();
        }
    });
    let initial = session.read().await.unwrap();
    let request = |revision, id: &str, title: &str| EditRequest {
        protocol: PROTOCOL,
        epoch: initial.epoch.clone(),
        expected_revision: revision,
        operation_id: id.into(),
        label: "Rename".into(),
        action: Action::Rename {
            title: title.into(),
        },
    };
    let first_request = request(0, "first", "First");
    let first_session = session.clone();
    let first = tokio::spawn(async move { first_session.dispatch(first_request).await });
    tokio::task::spawn_blocking(move || committed_rx.recv().unwrap())
        .await
        .unwrap();
    // Poll through queue acceptance, but hold the worker before its first reply.
    let second = session.dispatch(request(1, "second", "Queued before close"));
    tokio::pin!(second);
    std::future::poll_fn(|cx| {
        assert!(second.as_mut().poll(cx).is_pending());
        Poll::Ready(())
    })
    .await;
    first.abort();
    let closing_session = session.clone();
    let closing = tokio::task::spawn_blocking(move || closing_session.close());
    while !session.is_closing() {
        tokio::task::yield_now().await;
    }
    release.send(()).unwrap();
    assert_eq!(second.await.unwrap().revision, 2);
    closing.await.unwrap();
    let reopened = Session::start(path, |_| {});
    let restored = reopened.read().await.unwrap();
    assert_eq!(restored.revision, 2);
    assert_eq!(restored.title, "Queued before close");
    reopened.close();
}
