//! Profile lifecycle: create, list, switch isolation, epoch fencing,
//! double-open locks, backups and input validation.
use song_core::{Action, Time};
use song_session::{
    Session,
    protocol::{EditRequest, PROTOCOL},
};
use std::sync::{Arc, Mutex};

fn edit(epoch: &str, revision: u64, id: &str, title: &str) -> EditRequest {
    EditRequest {
        protocol: PROTOCOL,
        epoch: epoch.into(),
        expected_revision: revision,
        operation_id: id.into(),
        label: id.into(),
        action: Action::Rename {
            title: title.into(),
        },
    }
}

#[tokio::test]
async fn profiles_isolate_songs_and_fence_old_epochs() {
    let dir = tempfile::tempdir().unwrap();
    let events = Arc::new(Mutex::new(vec![]));
    let capture = events.clone();
    let session = Session::start(dir.path().into(), move |s| capture.lock().unwrap().push(s));
    let initial = session.read().await.unwrap();
    assert_eq!(initial.profile, "default");
    assert_eq!(session.profile_id().await.unwrap(), "default");
    let created = session.create_profile("second".into()).await.unwrap();
    assert_eq!(created.id, "second");
    assert_eq!(created.title.as_deref(), Some("Mixed-meter sketch"));
    assert_eq!(created.revision, Some(0));
    let mut ids: Vec<_> = session
        .profiles()
        .await
        .unwrap()
        .into_iter()
        .map(|p| p.id)
        .collect();
    ids.sort();
    assert_eq!(ids, ["default", "second"]);
    session
        .dispatch(edit(&initial.epoch, 0, "op", "First"))
        .await
        .unwrap();
    let switched = session.switch_profile("second".into()).await.unwrap();
    assert_eq!(switched.profile, "second");
    assert_ne!(switched.epoch, initial.epoch);
    assert_eq!(switched.revision, 0);
    assert_eq!(
        session
            .dispatch(edit(&initial.epoch, 1, "stale", "Stale"))
            .await
            .unwrap_err()
            .code,
        "session"
    );
    session
        .dispatch(edit(&switched.epoch, 0, "op", "Second"))
        .await
        .unwrap();
    let back = session.switch_profile("default".into()).await.unwrap();
    assert_eq!(back.title, "First");
    assert_eq!(back.revision, 1);
    // Backups bracket each departure.
    for profile in ["default", "second"] {
        let backups = dir.path().join(profile).join("backups");
        assert!(
            backups.is_dir() && std::fs::read_dir(&backups).unwrap().count() >= 1,
            "missing backup for {profile}"
        );
    }
    session.close();
}

#[tokio::test]
async fn profile_inputs_are_validated_and_missing_profiles_keep_state() {
    let dir = tempfile::tempdir().unwrap();
    let session = Session::start(dir.path().into(), |_| {});
    let initial = session.read().await.unwrap();
    assert_eq!(
        session.create_profile("".into()).await.unwrap_err().code,
        "invalid"
    );
    assert_eq!(
        session.create_profile("second".into()).await.unwrap().id,
        "second"
    );
    assert_eq!(
        session
            .create_profile("second".into())
            .await
            .unwrap_err()
            .code,
        "conflict"
    );
    assert_eq!(
        session
            .switch_profile("gone".into())
            .await
            .unwrap_err()
            .code,
        "missing"
    );
    // A failed switch leaves the current profile and epoch untouched.
    let current = session.read().await.unwrap();
    assert_eq!(current.epoch, initial.epoch);
    assert_eq!(current.profile, "default");
    // Switching to the current profile is a no-op on the same epoch.
    let same = session.switch_profile("default".into()).await.unwrap();
    assert_eq!(same.epoch, initial.epoch);
    assert_eq!(same.revision, 0);
    session.close();
}

#[tokio::test]
async fn double_opened_profiles_stay_fenced_until_released() {
    let dir = tempfile::tempdir().unwrap();
    let first = Session::start(dir.path().into(), |_| {});
    first.read().await.unwrap();
    let second = Session::start(dir.path().into(), |_| {});
    assert_eq!(second.read().await.unwrap_err().code, "locked");
    // The fenced session can still adopt a free profile.
    second.create_profile("second".into()).await.unwrap();
    let switched = second.switch_profile("second".into()).await.unwrap();
    assert_eq!(switched.profile, "second");
    first.close();
    // Once released, the original profile opens again.
    let back = second.switch_profile("default".into()).await.unwrap();
    assert_eq!(back.profile, "default");
    assert_eq!(back.title, "Mixed-meter sketch");
    second.close();
}

#[tokio::test]
async fn move_note_survives_a_profile_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let session = Session::start(dir.path().into(), |_| {});
    let initial = session.read().await.unwrap();
    let moved = session
        .dispatch(EditRequest {
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
        })
        .await
        .unwrap();
    assert_eq!(moved.revision, 1);
    session.create_profile("second".into()).await.unwrap();
    session.switch_profile("second".into()).await.unwrap();
    let back = session.switch_profile("default".into()).await.unwrap();
    assert_eq!(back.revision, 1);
    assert_eq!(
        back.notes
            .iter()
            .find(|n| n.member_id.as_deref() == Some("root"))
            .unwrap()
            .start,
        Time::new(1, 3).unwrap()
    );
    session.close();
}
