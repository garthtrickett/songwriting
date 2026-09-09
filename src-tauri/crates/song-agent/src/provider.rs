use rig_core::{
    client::CompletionClient,
    completion::{CompletionModel, Message, ToolDefinition},
    providers::{anthropic, openrouter},
};
use serde_json::json;
use song_session::protocol::Failure;
use std::{future::Future, pin::Pin};

pub type ModelFuture<'a> = Pin<Box<dyn Future<Output = Result<Message, Failure>> + Send + 'a>>;
/// An injectable provider boundary, not a second tool dispatcher or song model.
pub trait Model: Send + Sync {
    fn identity(&self) -> String;
    fn next(&self, messages: Vec<Message>) -> ModelFuture<'_>;
}
pub struct RigModel {
    provider: String,
    model: String,
    key: String,
}
impl RigModel {
    pub fn new(provider: String, model: String, key: String) -> Result<Self, Failure> {
        if !matches!(provider.as_str(), "anthropic" | "openrouter")
            || model.trim().is_empty()
            || model.len() > 150
            || key.trim().is_empty()
            || key.len() > 4096
        {
            return Err(Failure::new(
                "configuration",
                "Choose Anthropic or OpenRouter and supply a model and API key",
            ));
        }
        Ok(Self {
            provider,
            model,
            key,
        })
    }
}
impl Model for RigModel {
    fn identity(&self) -> String {
        format!("{}:{}", self.provider, self.model)
    }
    fn next(&self, messages: Vec<Message>) -> ModelFuture<'_> {
        Box::pin(async move {
            match self.provider.as_str() {
                "anthropic" => {
                    let client = anthropic::Client::new(&self.key).map_err(|_| provider_error())?;
                    request(client.completion_model(&self.model), messages).await
                }
                _ => {
                    let client =
                        openrouter::Client::new(&self.key).map_err(|_| provider_error())?;
                    request(client.completion_model(&self.model), messages).await
                }
            }
        })
    }
}
fn provider_error() -> Failure {
    // Provider error bodies can contain echoed input/headers. Never persist them.
    Failure::new(
        "provider",
        "Model request failed. Check the provider, model, key and connectivity, then resume.",
    )
}
async fn request<M: CompletionModel + Clone>(
    model: M,
    mut messages: Vec<Message>,
) -> Result<Message, Failure> {
    let prompt = messages
        .pop()
        .ok_or_else(|| Failure::new("invalid", "Missing agent context"))?;
    let request = model
        .completion_request(prompt)
        .messages(messages)
        .preamble(include_str!("prompt.txt").into())
        .tools(tools())
        .max_tokens(2048)
        .build();
    let response = model
        .completion(request)
        .await
        .map_err(|_| provider_error())?;
    Ok(Message::Assistant {
        id: response.message_id,
        content: response.choice,
    })
}
pub fn tools() -> Vec<ToolDefinition> {
    let object = |properties, required| json!({"type":"object", "properties":properties,"required":required,"additionalProperties":false});
    vec![
        ToolDefinition { name: "read_song".into(), description: "Inspect the current relative song, revision and undoable operation IDs.".into(), parameters: object(json!({}), json!([])) },
        ToolDefinition { name: "edit_song".into(), description: "Apply one musical action at the revision you inspected. Rust validates and saves it with an undo receipt. On conflict, inspect again and reconsider the request.".into(), parameters: object(json!({
            "expectedRevision":{"type":"integer","minimum":0},
            "action":{"oneOf":[
                object(json!({"kind":{"const":"rename"},"title":{"type":"string"}}),json!(["kind","title"])),
                object(json!({"kind":{"const":"moveNote"},"eventId":{"type":"string"},"memberId":{"type":["string","null"]},"start":{"type":"array","items":{"type":"integer"},"minItems":2,"maxItems":2}}),json!(["kind","eventId","memberId","start"])),
                object(json!({"kind":{"const":"undo"},"targetId":{"type":"string"}}),json!(["kind","targetId"]))
            ]}
        }),json!(["expectedRevision","action"])) },
        ToolDefinition { name: "complete_task".into(), description: "Explicitly finish the task with a brief user-visible summary, after checking tool results. This must be the final tool.".into(), parameters: object(json!({"summary":{"type":"string"}}),json!(["summary"])) },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use rig_core::completion::AssistantContent;
    use std::{
        io::{BufRead, BufReader, Read, Write},
        net::TcpListener,
        time::Duration,
    };

    #[tokio::test]
    async fn rig_tool_call_survives_serialization_and_replays_its_provider_id() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let server = std::thread::spawn(move || {
            let deadline = std::time::Instant::now() + Duration::from_secs(15);
            for turn in 0..2 {
                let mut socket = loop {
                    match listener.accept() {
                        Ok((s, _)) => break s,
                        Err(e)
                            if e.kind() == std::io::ErrorKind::WouldBlock
                                && std::time::Instant::now() < deadline =>
                        {
                            std::thread::sleep(Duration::from_millis(5))
                        }
                        Err(e) => panic!("Mock provider accept: {e}"),
                    }
                };
                socket
                    .set_read_timeout(Some(Duration::from_secs(10)))
                    .unwrap();
                let mut reader = BufReader::new(socket.try_clone().unwrap());
                let mut length = 0;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" {
                        break;
                    }
                    if line.to_lowercase().starts_with("content-length:") {
                        length = line
                            .split(':')
                            .nth(1)
                            .unwrap()
                            .trim()
                            .parse::<usize>()
                            .unwrap();
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                let input: serde_json::Value = serde_json::from_slice(&body).unwrap();
                if turn == 1 {
                    assert!(
                        input["messages"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|m| m["role"] == "tool" && m["tool_call_id"] == "provider-call-1")
                    );
                }
                let message = if turn == 0 {
                    json!({"role":"assistant","content":null,"tool_calls":[{"id":"provider-call-1","type":"function","function":{"name":"read_song","arguments":"{}"}}]})
                } else {
                    json!({"role":"assistant","content":"Received saved result"})
                };
                let body = json!({"id":"response-1","object":"chat.completion","created":0,"model":"test","choices":[{"index":0,"message":message,"finish_reason":if turn==0 {"tool_calls"} else {"stop"}}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}).to_string();
                write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
            }
        });
        let client = openrouter::Client::builder()
            .api_key("test-key")
            .base_url(format!("http://{address}"))
            .build()
            .unwrap();
        let model = client.completion_model("test");
        let first = request(model.clone(), vec![Message::user("Inspect")])
            .await
            .unwrap();
        let serialized = serde_json::to_string(&first).unwrap();
        let restored: Message = serde_json::from_str(&serialized).unwrap();
        let Message::Assistant { content, .. } = &restored else {
            panic!("Expected assistant");
        };
        let AssistantContent::ToolCall(call) = &content[0] else {
            panic!("Expected tool");
        };
        let result = Message::tool_result(call.id.to_string(), "read_song", "saved snapshot");
        request(model, vec![Message::user("Inspect"), restored, result])
            .await
            .unwrap();
        server.join().unwrap();
    }
}
