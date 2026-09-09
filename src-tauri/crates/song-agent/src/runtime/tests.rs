use super::*;

#[tokio::test]
async fn exhausted_resume_uses_durable_state_while_old_worker_is_still_unwinding() {
    let directory = tempfile::tempdir().unwrap();
    let session = Session::start(directory.path().join("workspace.sqlite"), |_| {});
    let task = session
        .agent(AgentWork::Begin {
            prompt: "Use the request budget".into(),
            model: "test:exhausted".into(),
        })
        .await
        .unwrap()
        .unwrap();
    let mut checkpoint = task.checkpoint;
    checkpoint.rounds = song_workspace::agent::MAX_ROUNDS;
    session
        .agent(AgentWork::Checkpoint {
            id: task.id.clone(),
            generation: task.generation,
            checkpoint,
        })
        .await
        .unwrap();
    session
        .agent(AgentWork::Pause {
            id: task.id.clone(),
            generation: task.generation,
            message: "Request limit reached".into(),
        })
        .await
        .unwrap();
    let runtime = Runtime::new(session.clone());
    // Hold the old worker unfinished deterministically; no sleeps/retries or
    // reliance on Windows/Linux scheduler timing to reproduce the CI race.
    runtime.execution.lock().await.job = Some(tokio::spawn(std::future::pending()));
    assert_eq!(runtime.resume(task.id).await.unwrap_err().code, "limit");
    assert_eq!(session.read().await.unwrap().revision, 0);
    runtime.shutdown().await;
    session.close();
}
