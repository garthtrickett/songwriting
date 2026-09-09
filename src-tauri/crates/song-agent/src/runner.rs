use crate::provider::Model;
use rig_core::completion::{AssistantContent, Message};
use song_session::{
    Session,
    agent::{AgentWork, Status, Task, ToolCall},
    protocol::Failure,
};
use song_workspace::agent::MAX_ROUNDS;
use std::{sync::Arc, time::Duration};

async fn save(session: &Session, task: &Task) -> Result<Task, Failure> {
    session
        .agent(AgentWork::Checkpoint {
            id: task.id.clone(),
            generation: task.generation,
            checkpoint: task.checkpoint.clone(),
        })
        .await?
        .ok_or_else(|| Failure::new("missing", "Missing task"))
}
/// All network work is outside SAM/SQLite. Dropping this future cancels the
/// request, while already accepted workspace operations still finish durably.
pub async fn run(session: Arc<Session>, model: Arc<dyn Model>, task: Task) -> Result<(), Failure> {
    run_with_audio(session, model, task, None).await
}
pub async fn run_with_audio(
    session: Arc<Session>,
    model: Arc<dyn Model>,
    mut task: Task,
    audio: Option<Arc<song_audio::Engine>>,
) -> Result<(), Failure> {
    if task.model != model.identity() {
        return Err(Failure::new(
            "configuration",
            "Resume with the original provider and model",
        ));
    }
    loop {
        if task.status != Status::Running {
            return Ok(());
        }
        for index in 0..task.checkpoint.calls.len() {
            if task.checkpoint.calls[index].result.is_none() {
                if crate::audio::is_tool(&task.checkpoint.calls[index].name) {
                    let call = task.checkpoint.calls[index].clone();
                    // At-most-once ephemeral effect: a crash here must not cause
                    // recovered tasks to start speakers unexpectedly.
                    task.checkpoint.calls[index].result = Some(
                        serde_json::json!({"interrupted": true, "message": "Audio attempt was interrupted; inspect current transport. Do not automatically replay it."}),
                    );
                    task = save(&session, &task).await?;
                    let result = crate::audio::execute(&session, audio.as_deref(), &call).await;
                    task.checkpoint.calls[index].result = Some(result);
                    task = save(&session, &task).await?;
                    continue;
                }
                task = session
                    .agent(AgentWork::Tool {
                        id: task.id.clone(),
                        generation: task.generation,
                        index,
                    })
                    .await?
                    .ok_or_else(|| Failure::new("missing", "Missing task"))?;
            }
            if task.status == Status::Completed {
                return Ok(());
            }
        }
        if !task.checkpoint.calls.is_empty() {
            // Preserve provider correlation handles from the journaled assistant
            // message. Rig resolves these IDs to the provider's wire identifiers.
            for call in &task.checkpoint.calls {
                let message = Message::tool_result(
                    &call.id,
                    &call.name,
                    call.result.as_ref().unwrap().to_string(),
                );
                task.checkpoint
                    .messages
                    .push(serde_json::to_value(message).map_err(context_error)?);
            }
            task.checkpoint.calls.clear();
        }
        if task.checkpoint.messages.is_empty() {
            task.checkpoint
                .messages
                .push(serde_json::to_value(Message::user(&task.prompt)).map_err(context_error)?);
        }
        if task.checkpoint.rounds >= MAX_ROUNDS {
            return Err(Failure::new(
                "limit",
                "Task reached its 12 model-request limit. Saved edits remain in history.",
            ));
        }
        // Reserve the request before sending it. Crashes/retries consume the same
        // bounded lifetime budget instead of silently resetting it on resume.
        task.checkpoint.rounds += 1;
        task = save(&session, &task).await?;
        let messages = task
            .checkpoint
            .messages
            .iter()
            .cloned()
            .map(serde_json::from_value)
            .collect::<Result<Vec<Message>, _>>()
            .map_err(context_error)?;
        let response = tokio::time::timeout(Duration::from_secs(60), model.next(messages))
            .await
            .map_err(|_| {
                Failure::new("timeout", "Model request timed out. Resume when ready.")
            })??;
        let Message::Assistant { content, .. } = &response else {
            return Err(Failure::new("provider", "Expected an assistant response"));
        };
        task.checkpoint.calls = content
            .iter()
            .filter_map(|c| match c {
                AssistantContent::ToolCall(c) => Some(ToolCall {
                    id: c.id.to_string(),
                    name: c.function.name.clone(),
                    arguments: c.function.arguments.clone(),
                    result: None,
                }),
                _ => None,
            })
            .collect();
        task.checkpoint
            .messages
            .push(serde_json::to_value(response).map_err(context_error)?);
        if task.checkpoint.calls.is_empty() {
            task.checkpoint.messages.push(
                serde_json::to_value(Message::user(
                    "Use the tools to continue or complete_task to explicitly finish.",
                ))
                .map_err(context_error)?,
            );
        }
        // Persist the entire tool batch before accepting even the first effect.
        task = save(&session, &task).await?;
    }
}
fn context_error(_: serde_json::Error) -> Failure {
    Failure::new("context", "Agent context could not be decoded")
}
