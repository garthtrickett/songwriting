//! Shared host transport actions for Tauri and Rig; no musical state is mutated.
use serde_json::{Value, json};
use song_audio::{AudioPlay, Engine};
use song_session::{Session, agent::ToolCall, protocol::Failure};

struct Pending<'a> {
    engine: &'a Engine,
    generation: u32,
    completed: bool,
}
impl Drop for Pending<'_> {
    fn drop(&mut self) {
        if !self.completed {
            self.engine.cancel_intent(self.generation);
        }
    }
}
pub async fn play(session: &Session, engine: &Engine, request: AudioPlay) -> Result<(), Failure> {
    let generation = engine.intent().map_err(Failure::from)?;
    let mut pending = Pending {
        engine,
        generation,
        completed: false,
    };
    let (song, revision) = session.song().await?;
    // Preserve device errors in status; only cancellation fences an abandoned start.
    let result = engine
        .play(generation, song, revision, request)
        .await
        .map_err(Failure::from);
    pending.completed = true;
    result
}
pub fn is_tool(name: &str) -> bool {
    matches!(name, "audio_status" | "play_audio" | "stop_audio")
}
pub async fn execute(session: &Session, engine: Option<&Engine>, call: &ToolCall) -> Value {
    match execute_inner(session, engine, call).await {
        Ok(value) => value,
        Err(e) => json!({"error":{"code":e.code,"message":e.message}}),
    }
}
async fn execute_inner(
    session: &Session,
    engine: Option<&Engine>,
    call: &ToolCall,
) -> Result<Value, Failure> {
    let engine =
        engine.ok_or_else(|| Failure::new("audio", "Native audio is not attached to this host"))?;
    if call.name != "play_audio" && call.arguments != json!({}) {
        return Err(Failure::new(
            "invalid",
            "This audio tool accepts an empty object",
        ));
    }
    match call.name.as_str() {
        "audio_status" => Ok(
            json!({"transport":engine.view().await.map_err(Failure::from)?, "devices":engine.devices().await.map_err(Failure::from)?}),
        ),
        "play_audio" => {
            let request = serde_json::from_value(call.arguments.clone()).map_err(|_| {
                Failure::new(
                    "invalid",
                    "Expected playback options: deviceId, tonic, metronome and from",
                )
            })?;
            play(session, engine, request).await?;
            Ok(
                json!({"started":true,"message":"Ephemeral playback started; inspect audio_status for its current state."}),
            )
        }
        "stop_audio" => {
            engine.stop().map_err(Failure::from)?;
            Ok(json!({"stopped":true}))
        }
        _ => Err(Failure::new("invalid", "Unknown audio tool")),
    }
}
