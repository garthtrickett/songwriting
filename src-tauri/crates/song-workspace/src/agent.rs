//! Durable agent journal. Only the workspace worker writes this journal or music.
use crate::{Workspace, apply, load, storage};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use song_core::{Action, Error, Mutation, Result};

pub const MAX_ROUNDS: u32 = 12;
const MAX_BYTES: usize = 262_144;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Running,
    Interrupted,
    Cancelled,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
    pub result: Option<Value>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Checkpoint {
    pub messages: Vec<Value>,
    pub calls: Vec<ToolCall>,
    pub rounds: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Task {
    pub id: String,
    pub generation: u32,
    pub status: Status,
    pub prompt: String,
    pub model: String,
    pub checkpoint: Checkpoint,
    pub message: String,
}
impl Task {
    fn validate(&self) -> Result<()> {
        if self.checkpoint.rounds > MAX_ROUNDS
            || self.checkpoint.calls.len() > 8
            || self.checkpoint.messages.len() > 128
            || serde_json::to_vec(self).map_err(storage)?.len() > MAX_BYTES
        {
            return Err(Error::new("limit", "Agent context or step limit reached"));
        }
        let mut ids = std::collections::BTreeSet::new();
        if self
            .checkpoint
            .calls
            .iter()
            .any(|c| c.id.is_empty() || c.id.len() > 256 || !ids.insert(&c.id))
        {
            return Err(Error::new(
                "invalid",
                "Invalid or duplicate tool call identity",
            ));
        }
        Ok(())
    }
}
fn read(connection: &rusqlite::Connection, id: Option<&str>) -> Result<Option<Task>> {
    let sql = if id.is_some() {
        "SELECT task FROM agent_tasks WHERE id = ?1"
    } else {
        "SELECT task FROM agent_tasks WHERE ?1 IS NULL ORDER BY rowid DESC LIMIT 1"
    };
    let data: Option<String> = connection
        .query_row(sql, [id], |r| r.get(0))
        .optional()
        .map_err(storage)?;
    data.map(|s| {
        let task: Task = serde_json::from_str(&s).map_err(storage)?;
        task.validate()?;
        Ok(task)
    })
    .transpose()
}
fn write(connection: &rusqlite::Connection, task: &Task) -> Result<()> {
    task.validate()?;
    connection.execute("INSERT INTO agent_tasks (id, task) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET task = excluded.task",
        params![task.id, serde_json::to_string(task).map_err(storage)?]).map_err(storage)?;
    Ok(())
}
fn running(connection: &rusqlite::Connection, id: &str, generation: u32) -> Result<Task> {
    let task = read(connection, Some(id))?
        .ok_or_else(|| Error::new("missing", "Agent task does not exist"))?;
    if task.status != Status::Running || task.generation != generation {
        return Err(Error::new(
            "cancelled",
            "This agent execution is no longer active",
        ));
    }
    Ok(task)
}
impl Workspace {
    pub fn agent_task(&self) -> Result<Option<Task>> {
        read(&self.connection, None)
    }
    pub fn agent_begin(&mut self, id: String, prompt: String, model: String) -> Result<Task> {
        if prompt.trim().is_empty() || prompt.len() > 8000 || model.is_empty() || model.len() > 200
        {
            return Err(Error::new(
                "invalid",
                "Supply a request (up to 8000 bytes) and a model",
            ));
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        if read(&tx, None)?
            .is_some_and(|t| matches!(t.status, Status::Running | Status::Interrupted))
        {
            return Err(Error::new(
                "busy",
                "Resume or cancel the existing task first",
            ));
        }
        let count: i64 = tx
            .query_row("SELECT count(*) FROM agent_tasks", [], |r| r.get(0))
            .map_err(storage)?;
        if count >= 64 {
            return Err(Error::new("limit", "D1 fixture task limit reached (64)"));
        }
        let task = Task {
            id,
            generation: 1,
            status: Status::Running,
            prompt,
            model,
            checkpoint: Checkpoint::default(),
            message: "Starting agent".into(),
        };
        write(&tx, &task)?;
        tx.commit().map_err(storage)?;
        Ok(task)
    }
    pub fn agent_control(&mut self, id: &str, status: Status, message: String) -> Result<Task> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let mut task = read(&tx, Some(id))?
            .ok_or_else(|| Error::new("missing", "Agent task does not exist"))?;
        if matches!(task.status, Status::Completed | Status::Cancelled) {
            return Err(Error::new("invalid", "This task has already ended"));
        }
        if status == Status::Running && task.status == Status::Running {
            return Err(Error::new("busy", "Task is already running"));
        }
        task.generation = task
            .generation
            .checked_add(1)
            .ok_or_else(|| Error::new("limit", "Task generation exhausted"))?;
        task.status = status;
        task.message = message;
        write(&tx, &task)?;
        tx.commit().map_err(storage)?;
        Ok(task)
    }
    /// Called once when the owning application opens. Never auto-resume a model.
    pub fn agent_recover(&mut self) -> Result<()> {
        if let Some(task) = self.agent_task()?
            && task.status == Status::Running
        {
            self.agent_control(
                &task.id,
                Status::Interrupted,
                "Interrupted. Resume to reconcile saved tool results.".into(),
            )?;
        }
        Ok(())
    }
    pub fn agent_checkpoint(
        &mut self,
        id: &str,
        generation: u32,
        checkpoint: Checkpoint,
    ) -> Result<Task> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let mut task = running(&tx, id, generation)?;
        task.checkpoint = checkpoint;
        task.message = "Working".into();
        write(&tx, &task)?;
        tx.commit().map_err(storage)?;
        Ok(task)
    }
    /// Completion/error from an old network request cannot modify a new execution.
    pub fn agent_pause(&mut self, id: &str, generation: u32, message: String) -> Result<Task> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let mut task = running(&tx, id, generation)?;
        task.status = Status::Interrupted;
        task.message = message;
        write(&tx, &task)?;
        tx.commit().map_err(storage)?;
        Ok(task)
    }
    /// Execute one journaled primitive. Its result and musical receipt commit
    /// together; replay returns the original result, even after intervening edits.
    pub fn agent_tool(&mut self, id: &str, generation: u32, index: usize) -> Result<Task> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let mut task = running(&tx, id, generation)?;
        let call = task
            .checkpoint
            .calls
            .get(index)
            .ok_or_else(|| Error::new("invalid", "Missing pending tool"))?
            .clone();
        if call.result.is_some() {
            return Ok(task);
        }
        if task.checkpoint.calls[..index]
            .iter()
            .any(|c| c.result.is_none())
        {
            return Err(Error::new("invalid", "Tool calls must execute in order"));
        }
        let result = execute(&tx, &task, &call, index);
        let value = match result {
            Ok(value) => value,
            Err(e) if e.code == "storage" => return Err(e),
            Err(e) => json!({"error": {"code": e.code, "message": e.message}}),
        };
        if call.name == "complete_task" && value.get("error").is_none() {
            task.status = Status::Completed;
            task.message = value["summary"].as_str().unwrap_or("Completed").into();
        } else {
            task.message = format!("Finished {}", call.name);
        }
        task.checkpoint.calls[index].result = Some(value);
        write(&tx, &task)?;
        tx.commit().map_err(storage)?;
        Ok(task)
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Edit {
    expected_revision: u64,
    action: Action,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Completion {
    summary: String,
}
fn execute(
    tx: &rusqlite::Transaction<'_>,
    task: &Task,
    call: &ToolCall,
    index: usize,
) -> Result<Value> {
    let before =
        load(tx, "desktop-fixture")?.ok_or_else(|| Error::new("missing", "Song does not exist"))?;
    match call.name.as_str() {
        "read_song" => {
            if call.arguments != json!({}) {
                return Err(Error::new("invalid", "read_song takes no arguments"));
            }
            serde_json::to_value(before.state()).map_err(storage)
        }
        "edit_song" => {
            let input: Edit = serde_json::from_value(call.arguments.clone()).map_err(|_| {
                Error::new(
                    "invalid",
                    "Expected expectedRevision and a supported action",
                )
            })?;
            let mutation = Mutation {
                song_id: before.song.id.clone(),
                expected_revision: input.expected_revision,
                operation_id: format!("agent-{}-{}-{index}", task.id, task.checkpoint.rounds),
                label: "Agent edit".into(),
                action: input.action,
            };
            let state = apply(tx, &mutation)?;
            Ok(
                json!({"operationId": mutation.operation_id, "revision": state.revision, "title": state.song.title}),
            )
        }
        "complete_task" => {
            let completion: Completion = serde_json::from_value(call.arguments.clone())
                .map_err(|_| Error::new("invalid", "Supply a completion summary"))?;
            if completion.summary.is_empty()
                || completion.summary.len() > 4000
                || index + 1 != task.checkpoint.calls.len()
            {
                return Err(Error::new(
                    "invalid",
                    "Completion needs a short summary and must be the final tool",
                ));
            }
            Ok(json!({"summary": completion.summary}))
        }
        _ => Err(Error::new(
            "unsupported",
            "Unknown tool; use the advertised primitives",
        )),
    }
}
