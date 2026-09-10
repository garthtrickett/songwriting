use rig_core::completion::{AssistantContent, Message};
use rig_core::message::{ToolCall as RigCall, ToolFunction};
use serde_json::{Value, json};
use song_agent::{
    provider::{Model, ModelFuture},
    runtime::Runtime,
};
use song_core::Action;
use song_session::{
    Session,
    agent::{AgentWork, Status},
    protocol::{EditRequest, Failure},
};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

fn call(id: &str, name: &str, arguments: Value) -> Message {
    Message::Assistant {
        id: None,
        content: vec![AssistantContent::ToolCall(RigCall::from_wire(
            id,
            ToolFunction {
                name: name.into(),
                arguments,
            },
        ))],
    }
}
struct Scripted {
    resumed: bool,
}
impl Model for Scripted {
    fn identity(&self) -> String {
        "test:scripted".into()
    }
    fn next(&self, messages: Vec<Message>) -> ModelFuture<'_> {
        Box::pin(async move {
            let history = serde_json::to_string(&messages).unwrap();
            if history.contains("agent-") {
                assert!(history.contains("Crooked Steps"));
                // Recovery must return the original saved result, not the current
                // revision/title after another user edit.
                if self.resumed {
                    assert!(!history.contains("Manual after restart"));
                }
                Ok(call(
                    "done",
                    "complete_task",
                    json!({"summary":"Renamed the inspected sketch."}),
                ))
            } else if history.contains("Mixed-meter sketch") {
                assert!(!self.resumed, "A resumed task must not ask to edit again");
                Ok(call(
                    "rename",
                    "edit_song",
                    json!({"expectedRevision":0,"action":{"kind":"rename","title":"Crooked Steps"}}),
                ))
            } else {
                assert!(!self.resumed);
                Ok(call("inspect", "read_song", json!({})))
            }
        })
    }
}
async fn wait_status(runtime: &Runtime, expected: &str) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if runtime
                .view()
                .await
                .unwrap()
                .task
                .is_some_and(|t| t.status == expected)
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("Task status did not settle");
}
async fn manual(session: &Session, title: &str) {
    let s = session.read().await.unwrap();
    tokio::time::timeout(
        Duration::from_secs(2),
        session.dispatch(EditRequest {
            protocol: 1,
            epoch: s.epoch,
            operation_id: format!("manual-{}", s.revision),
            expected_revision: s.revision,
            label: "Manual edit".into(),
            action: Action::Rename {
                title: title.into(),
            },
        }),
    )
    .await
    .expect("Manual edit blocked on agent")
    .unwrap();
}

#[tokio::test]
async fn crash_child() {
    let Ok(path) = std::env::var("SONGWRITER_TEST_CRASH_PATH") else {
        return;
    };
    let session = Session::start(path.into(), |s| {
        if s.revision == 1 {
            std::process::exit(73);
        }
    });
    let runtime = Runtime::new(session);
    runtime
        .set_model(Arc::new(Scripted { resumed: false }))
        .await
        .unwrap();
    runtime
        .start("Inspect and rename to Crooked Steps".into())
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_secs(10)).await;
    panic!("Did not reach the committed-edit/before-reply boundary");
}
#[tokio::test]
async fn process_restart_replays_saved_result_once_and_preserves_intervening_manual_edit() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("profiles");
    let child = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "crash_child", "--nocapture"])
        .env("SONGWRITER_TEST_CRASH_PATH", &path)
        .output()
        .unwrap();
    assert_eq!(
        child.status.code(),
        Some(73),
        "{}",
        String::from_utf8_lossy(&child.stderr)
    );
    let session = Session::start(path.clone(), |_| {});
    let task = session.agent(AgentWork::Read).await.unwrap().unwrap();
    assert_eq!(task.status, Status::Interrupted);
    assert_eq!(
        task.checkpoint.calls[0].result.as_ref().unwrap()["revision"],
        1
    );
    assert_eq!(session.read().await.unwrap().title, "Crooked Steps");
    manual(&session, "Manual after restart").await;
    let runtime = Runtime::new(session.clone());
    runtime
        .set_model(Arc::new(Scripted { resumed: true }))
        .await
        .unwrap();
    runtime.resume(task.id).await.unwrap();
    wait_status(&runtime, "completed").await;
    let state = session.read().await.unwrap();
    assert_eq!(state.title, "Manual after restart");
    assert_eq!(state.revision, 2);
    runtime.shutdown().await;
    session.close();
    let workspace = song_workspace::Workspace::open(path.join("default/workspace.sqlite")).unwrap();
    let envelope = workspace.read("desktop-fixture").unwrap();
    assert_eq!(envelope.history.len(), 2);
    assert_eq!(
        envelope
            .history
            .iter()
            .filter(|r| r.operation_id.starts_with("agent-"))
            .count(),
        1
    );
}
struct Stalled {
    entered: Arc<AtomicUsize>,
}
impl Model for Stalled {
    fn identity(&self) -> String {
        "test:stalled".into()
    }
    fn next(&self, _: Vec<Message>) -> ModelFuture<'_> {
        self.entered.fetch_add(1, Ordering::SeqCst);
        Box::pin(std::future::pending())
    }
}
#[tokio::test]
async fn cancellation_fences_late_tools_and_manual_editing_stays_responsive() {
    let dir = tempfile::tempdir().unwrap();
    let session = Session::start(dir.path().join("profiles"), |_| {});
    let entered = Arc::new(AtomicUsize::new(0));
    let runtime = Runtime::new(session.clone());
    runtime
        .set_model(Arc::new(Stalled {
            entered: entered.clone(),
        }))
        .await
        .unwrap();
    runtime.start("Wait for model".into()).await.unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        while entered.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let task = session.agent(AgentWork::Read).await.unwrap().unwrap();
    manual(&session, "While model is stalled").await;
    tokio::time::timeout(Duration::from_secs(2), runtime.cancel(task.id.clone()))
        .await
        .expect("Cancel blocked on provider")
        .unwrap();
    wait_status(&runtime, "cancelled").await;
    let error = session
        .agent(AgentWork::Checkpoint {
            id: task.id.clone(),
            generation: task.generation,
            checkpoint: task.checkpoint,
        })
        .await
        .unwrap_err();
    assert_eq!(error.code, "cancelled");
    let error = session
        .agent(AgentWork::Tool {
            id: task.id,
            generation: task.generation,
            index: 0,
        })
        .await
        .unwrap_err();
    assert_eq!(error.code, "cancelled");
    manual(&session, "After cancellation").await;
    runtime.shutdown().await;
    session.close();
}
struct Failed;
impl Model for Failed {
    fn identity(&self) -> String {
        "test:failed".into()
    }
    fn next(&self, _: Vec<Message>) -> ModelFuture<'_> {
        Box::pin(async { Err(Failure::new("provider", "Offline")) })
    }
}
#[tokio::test]
async fn missing_credentials_and_network_failure_leave_manual_work_available() {
    let dir = tempfile::tempdir().unwrap();
    let session = Session::start(dir.path().join("profiles"), |_| {});
    let runtime = Runtime::new(session.clone());
    assert_eq!(
        runtime.start("Rename".into()).await.unwrap_err().code,
        "configuration"
    );
    manual(&session, "No credentials").await;
    runtime.set_model(Arc::new(Failed)).await.unwrap();
    runtime.start("Rename".into()).await.unwrap();
    wait_status(&runtime, "interrupted").await;
    assert_eq!(runtime.view().await.unwrap().task.unwrap().rounds, 1);
    manual(&session, "Offline").await;
    runtime.shutdown().await;
    session.close();
}

struct Endless;
impl Model for Endless {
    fn identity(&self) -> String {
        "test:endless".into()
    }
    fn next(&self, _: Vec<Message>) -> ModelFuture<'_> {
        Box::pin(async { Ok(Message::assistant("Still working")) })
    }
}
#[tokio::test]
async fn completion_is_explicit_and_request_budget_survives_resume() {
    let dir = tempfile::tempdir().unwrap();
    let session = Session::start(dir.path().join("profiles"), |_| {});
    let runtime = Runtime::new(session.clone());
    runtime.set_model(Arc::new(Endless)).await.unwrap();
    runtime.start("Finish".into()).await.unwrap();
    wait_status(&runtime, "interrupted").await;
    let task = runtime.view().await.unwrap().task.unwrap();
    assert_eq!(task.rounds, 12);
    assert!(task.message.contains("limit"));
    assert_eq!(runtime.resume(task.id).await.unwrap_err().code, "limit");
    assert_eq!(session.read().await.unwrap().revision, 0);
    runtime.shutdown().await;
    session.close();
}

struct AudioReplay;
impl Model for AudioReplay {
    fn identity(&self) -> String {
        "test:audio-replay".into()
    }
    fn next(&self, messages: Vec<Message>) -> ModelFuture<'_> {
        Box::pin(async move {
            assert!(
                serde_json::to_string(&messages)
                    .unwrap()
                    .contains("interrupted")
            );
            Ok(call(
                "done-audio",
                "complete_task",
                json!({"summary":"Interrupted audition was not replayed."}),
            ))
        })
    }
}
#[tokio::test]
async fn interrupted_ephemeral_audio_is_not_replayed_on_resume() {
    let dir = tempfile::tempdir().unwrap();
    let session = Session::start(dir.path().join("profiles"), |_| {});
    let task = session
        .agent(AgentWork::Begin {
            prompt: "Play sketch".into(),
            model: "test:audio-replay".into(),
        })
        .await
        .unwrap()
        .unwrap();
    let mut checkpoint = task.checkpoint;
    checkpoint.messages.push(
        serde_json::to_value(call("play-once", "play_audio", json!({"deviceId":null}))).unwrap(),
    );
    checkpoint.calls.push(song_session::agent::ToolCall {
        id: "play-once".into(),
        name: "play_audio".into(),
        arguments: json!({"deviceId":null}),
        result: Some(json!({"interrupted":true})),
    });
    session
        .agent(AgentWork::Checkpoint {
            id: task.id.clone(),
            generation: task.generation,
            checkpoint,
        })
        .await
        .unwrap();
    session
        .agent(AgentWork::Control {
            id: task.id.clone(),
            status: song_session::agent::Status::Interrupted,
        })
        .await
        .unwrap();
    let audio = song_audio::Engine::new();
    let runtime = Runtime::with_audio(session.clone(), audio.clone());
    runtime.set_model(Arc::new(AudioReplay)).await.unwrap();
    runtime.resume(task.id).await.unwrap();
    wait_status(&runtime, "completed").await;
    assert_eq!(audio.view().await.unwrap().generation, 0);
    assert_eq!(session.read().await.unwrap().revision, 0);
    runtime.shutdown().await;
    audio.close();
    session.close();
}
#[tokio::test]
async fn manual_playback_never_requires_a_configured_provider() {
    let dir = tempfile::tempdir().unwrap();
    let session = Session::start(dir.path().join("profiles"), |_| {});
    let runtime = Runtime::new(session.clone());
    assert_eq!(
        runtime.start("Play".into()).await.unwrap_err().code,
        "configuration"
    );
    let audio = song_audio::Engine::new();
    match song_agent::audio::play(
        &session,
        &audio,
        song_audio::AudioPlay {
            device_id: None,
            tonic: None,
            metronome: None,
            from: None,
        },
    )
    .await
    {
        Ok(()) => {
            let _ = audio.stop();
        }
        Err(failure) => assert!(
            !["configuration", "provider"].contains(&failure.code.as_str()),
            "Playback failed on provider setup: {failure:?}"
        ),
    }
    manual(&session, "After playback attempt").await;
    runtime.shutdown().await;
    audio.close();
    session.close();
}
