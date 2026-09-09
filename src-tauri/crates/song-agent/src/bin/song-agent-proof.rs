//! Disposable live-model recovery proof. Never opens the user's app profile.
use song_agent::{provider::RigModel, runtime::Runtime};
use song_session::Session;
use std::{path::PathBuf, sync::Arc, time::Duration};

#[tokio::main(flavor = "current_thread")]
async fn main() {
    if let Err(message) = proof().await {
        eprintln!("{message}");
        std::process::exit(1);
    }
}
async fn proof() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        return Err("Usage: song-agent-proof <disposable-db> start [--exit-after-edit] | resume | inspect | undo".into());
    }
    let path = PathBuf::from(&args[1]);
    let mode = args[2].as_str();
    let crash = args.iter().any(|s| s == "--exit-after-edit");
    if crash && (mode != "start" || path.exists()) {
        return Err("The crash proof requires start with a new disposable database".into());
    }
    let session = Session::start(path, move |s| {
        if crash && s.revision > 0 {
            std::process::exit(73);
        }
    });
    if mode == "inspect" {
        let state = session.read().await.map_err(|e| e.message)?;
        println!(
            "revision={} title={} undoable={}",
            state.revision,
            state.title,
            state.undoable.len()
        );
        session.close();
        return Ok(());
    }
    if mode == "undo" {
        let s = session.read().await.map_err(|e| e.message)?;
        let target = s.undoable.last().ok_or("No change to undo")?;
        let value = serde_json::json!({"protocol":1,"epoch":s.epoch,"expectedRevision":s.revision,"operationId":format!("proof-undo-{}",s.revision),"label":"Undo proof","action":{"kind":"undo","targetId":target.operation_id}});
        let next = session
            .dispatch(serde_json::from_value(value).map_err(|_| "Invalid undo")?)
            .await
            .map_err(|e| e.message)?;
        println!("revision={} title={}", next.revision, next.title);
        session.close();
        return Ok(());
    }
    let env = |name| {
        std::env::var(name).map_err(|_| {
            format!("Set {name} in the host environment (never in source or command arguments)")
        })
    };
    let model = RigModel::new(
        env("SONGWRITER_AGENT_PROVIDER")?,
        env("SONGWRITER_AGENT_MODEL")?,
        env("SONGWRITER_AGENT_KEY")?,
    )
    .map_err(|e| e.message)?;
    let runtime = Runtime::new(session.clone());
    runtime
        .set_model(Arc::new(model))
        .await
        .map_err(|e| e.message)?;
    match mode {
        "start" => runtime.start("Inspect the current song using read_song, then rename it to Crooked Steps using edit_song. Check the result and explicitly complete the task.".into()).await,
        "resume" => {
            let task = runtime.view().await.map_err(|e| e.message)?.task.ok_or("No task to resume")?;
            runtime.resume(task.id).await
        }
        _ => return Err("Unknown proof mode".into()),
    }.map_err(|e| e.message)?;
    loop {
        let view = runtime.view().await.map_err(|e| e.message)?;
        let task = view.task.ok_or("Task disappeared")?;
        if task.status != "running" {
            let s = session.read().await.map_err(|e| e.message)?;
            println!(
                "provider/model={} status={} requests={} revision={} title={}",
                task.model, task.status, task.rounds, s.revision, s.title
            );
            runtime.shutdown().await;
            session.close();
            return if task.status == "completed" {
                Ok(())
            } else {
                Err(task.message)
            };
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}
