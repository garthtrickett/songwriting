use crate::{Session, Work, protocol::Failure, receive_task};
pub use song_workspace::agent::{Checkpoint, Status, Task, ToolCall};
use tokio::sync::oneshot;

/// Internal host interface. The renderer never receives journal-write access.
pub enum AgentWork {
    Read,
    Begin {
        prompt: String,
        model: String,
    },
    Control {
        id: String,
        status: Status,
    },
    Checkpoint {
        id: String,
        generation: u32,
        checkpoint: Checkpoint,
    },
    Tool {
        id: String,
        generation: u32,
        index: usize,
    },
    Pause {
        id: String,
        generation: u32,
        message: String,
    },
}
impl Session {
    pub async fn agent(&self, work: AgentWork) -> Result<Option<Task>, Failure> {
        let (tx, rx) = oneshot::channel();
        self.send(Work::Agent(work, tx))?;
        receive_task(rx).await
    }
}
pub(crate) fn run(
    workspace: &mut song_workspace::Workspace,
    work: AgentWork,
) -> song_core::Result<Option<Task>> {
    let task = match work {
        AgentWork::Read => return workspace.agent_task(),
        AgentWork::Begin { prompt, model } => {
            workspace.agent_begin(uuid::Uuid::new_v4().to_string(), prompt, model)?
        }
        AgentWork::Control { id, status } => {
            let message = match status {
                Status::Running => "Resuming",
                Status::Cancelled => "Cancelled. Saved edits remain in history.",
                _ => "Interrupted",
            };
            workspace.agent_control(&id, status, message.into())?
        }
        AgentWork::Checkpoint {
            id,
            generation,
            checkpoint,
        } => workspace.agent_checkpoint(&id, generation, checkpoint)?,
        AgentWork::Tool {
            id,
            generation,
            index,
        } => workspace.agent_tool(&id, generation, index)?,
        AgentWork::Pause {
            id,
            generation,
            message,
        } => workspace.agent_pause(&id, generation, message)?,
    };
    Ok(Some(task))
}
