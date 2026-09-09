use crate::{
    provider::{Model, RigModel},
    runner,
};
use song_session::{
    Session,
    agent::{AgentWork, Status, Task},
    protocol::{AgentConfig, AgentView, Failure, TaskView},
};
use std::sync::Arc;
use tokio::{sync::Mutex, task::JoinHandle};

struct Execution {
    model: Option<Arc<dyn Model>>,
    job: Option<JoinHandle<()>>,
}
/// One execution owner per local profile. This lock covers lifecycle transitions,
/// never provider requests. The separate workspace queue still accepts UI edits.
pub struct Runtime {
    session: Arc<Session>,
    execution: Mutex<Execution>,
    audio: Option<Arc<song_audio::Engine>>,
}
impl Runtime {
    pub fn new(session: Arc<Session>) -> Self {
        Self {
            session,
            audio: None,
            execution: Mutex::new(Execution {
                model: None,
                job: None,
            }),
        }
    }
    pub fn with_audio(session: Arc<Session>, audio: Arc<song_audio::Engine>) -> Self {
        let mut runtime = Self::new(session);
        runtime.audio = Some(audio);
        runtime
    }
    pub async fn configure(&self, config: AgentConfig) -> Result<(), Failure> {
        self.set_model(Arc::new(RigModel::new(
            config.provider,
            config.model,
            config.api_key,
        )?))
        .await
    }
    pub async fn set_model(&self, model: Arc<dyn Model>) -> Result<(), Failure> {
        let mut execution = self.execution.lock().await;
        if execution.job.as_ref().is_some_and(|j| !j.is_finished()) {
            return Err(Failure::new(
                "busy",
                "Cancel the active task before changing credentials",
            ));
        }
        execution.model = Some(model);
        Ok(())
    }
    pub async fn view(&self) -> Result<AgentView, Failure> {
        let model = self
            .execution
            .lock()
            .await
            .model
            .as_ref()
            .map(|m| m.identity());
        let task = self.session.agent(AgentWork::Read).await?;
        Ok(AgentView {
            configured_model: model,
            task: task.map(view),
        })
    }
    pub async fn start(&self, prompt: String) -> Result<(), Failure> {
        let mut execution = self.execution.lock().await;
        let model = configured(&execution)?;
        let task = self
            .session
            .agent(AgentWork::Begin {
                prompt,
                model: model.identity(),
            })
            .await?
            .ok_or_else(|| Failure::new("missing", "Task was not created"))?;
        launch(
            &mut execution,
            self.session.clone(),
            model,
            task,
            self.audio.clone(),
        );
        Ok(())
    }
    pub async fn resume(&self, id: String) -> Result<(), Failure> {
        let mut execution = self.execution.lock().await;
        let task = self
            .session
            .agent(AgentWork::Read)
            .await?
            .ok_or_else(|| Failure::new("missing", "No task to resume"))?;
        // The durable interruption can become visible before the worker's final
        // await unwinds. An exhausted task cannot resume regardless of whether
        // that worker's JoinHandle has finished yet.
        let exhausted = task.checkpoint.rounds >= song_workspace::agent::MAX_ROUNDS
            && task.checkpoint.calls.is_empty();
        if task.id == id && task.status == Status::Interrupted && exhausted {
            return Err(Failure::new(
                "limit",
                "This task has exhausted its model-request budget",
            ));
        }
        let model = configured(&execution)?;
        if task.id != id || task.model != model.identity() {
            return Err(Failure::new(
                "configuration",
                "Resume the current task using its original provider and model",
            ));
        }
        if exhausted {
            return Err(Failure::new(
                "limit",
                "This task has exhausted its model-request budget",
            ));
        }
        let task = self
            .session
            .agent(AgentWork::Control {
                id,
                status: Status::Running,
            })
            .await?
            .unwrap();
        launch(
            &mut execution,
            self.session.clone(),
            model,
            task,
            self.audio.clone(),
        );
        Ok(())
    }
    pub async fn cancel(&self, id: String) -> Result<(), Failure> {
        let mut execution = self.execution.lock().await;
        let current = self.session.agent(AgentWork::Read).await?;
        if current.as_ref().is_none_or(|t| t.id != id) {
            return Err(Failure::new(
                "session",
                "The active task changed; refresh before cancelling",
            ));
        }
        // Durable fence first. Any late completion/tool now fails its generation.
        self.session
            .agent(AgentWork::Control {
                id,
                status: Status::Cancelled,
            })
            .await?;
        stop(&mut execution).await;
        Ok(())
    }
    pub async fn shutdown(&self) {
        let mut execution = self.execution.lock().await;
        if let Ok(Some(task)) = self.session.agent(AgentWork::Read).await
            && task.status == Status::Running
        {
            let _ = self
                .session
                .agent(AgentWork::Control {
                    id: task.id,
                    status: Status::Interrupted,
                })
                .await;
        }
        stop(&mut execution).await;
        execution.model = None;
    }
}
fn configured(execution: &Execution) -> Result<Arc<dyn Model>, Failure> {
    if execution.job.as_ref().is_some_and(|j| !j.is_finished()) {
        return Err(Failure::new("busy", "An agent task is already running"));
    }
    execution
        .model
        .clone()
        .ok_or_else(|| Failure::new("configuration", "Configure a session API key first"))
}
fn launch(
    execution: &mut Execution,
    session: Arc<Session>,
    model: Arc<dyn Model>,
    task: Task,
    audio: Option<Arc<song_audio::Engine>>,
) {
    let id = task.id.clone();
    let generation = task.generation;
    execution.job = Some(tokio::spawn(async move {
        if let Err(error) = runner::run_with_audio(session.clone(), model, task, audio).await {
            let _ = session
                .agent(AgentWork::Pause {
                    id,
                    generation,
                    message: error.message,
                })
                .await;
        }
    }));
}
async fn stop(execution: &mut Execution) {
    if let Some(job) = execution.job.take() {
        job.abort();
        let _ = job.await;
    }
}
fn view(task: Task) -> TaskView {
    TaskView {
        id: task.id,
        status: match task.status {
            Status::Running => "running",
            Status::Interrupted => "interrupted",
            Status::Cancelled => "cancelled",
            Status::Completed => "completed",
            Status::Failed => "failed",
        }
        .into(),
        prompt: task.prompt,
        model: task.model,
        message: task.message,
        rounds: task.checkpoint.rounds,
    }
}

#[cfg(test)]
mod tests;
