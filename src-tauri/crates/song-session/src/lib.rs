mod projection;
pub mod protocol;
use protocol::{EditRequest, Failure, PROTOCOL, Snapshot};
use song_core::{Mutation, Song};
use song_workspace::Workspace;
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
};
use tokio::sync::oneshot;

type Reply = oneshot::Sender<Result<Snapshot, Failure>>;
enum Work {
    Read(Reply),
    Edit(EditRequest, Reply),
    Close,
}

/// One serialized workspace worker per app, outside the Tauri/UI runtime.
pub struct Session {
    sender: Mutex<mpsc::SyncSender<Work>>,
    closing: AtomicBool,
    join: Mutex<Option<thread::JoinHandle<()>>>,
}
impl Session {
    pub fn start(path: PathBuf, changed: impl Fn(Snapshot) + Send + 'static) -> Arc<Self> {
        let (sender, receiver) = mpsc::sync_channel(32);
        let epoch = uuid::Uuid::new_v4().to_string();
        let join = thread::spawn(move || {
            let mut workspace = open(path);
            while let Ok(work) = receiver.recv() {
                let (request, reply) = match work {
                    Work::Read(r) => (None, r),
                    Work::Edit(m, r) => (Some(m), r),
                    Work::Close => break,
                };
                let result = match workspace.as_mut() {
                    Err(e) => Err(e.clone()),
                    Ok(workspace) => run(workspace, request.as_ref(), &epoch),
                };
                if request.is_some()
                    && let Ok(snapshot) = &result
                {
                    changed(snapshot.clone());
                }
                // A closed renderer doesn't cancel an accepted durable command.
                let _ = reply.send(result);
            }
        });
        Arc::new(Self {
            sender: Mutex::new(sender),
            closing: AtomicBool::new(false),
            join: Mutex::new(Some(join)),
        })
    }
    pub async fn read(&self) -> Result<Snapshot, Failure> {
        let (tx, rx) = oneshot::channel();
        self.send(Work::Read(tx))?;
        receive(rx).await
    }
    pub async fn dispatch(&self, request: EditRequest) -> Result<Snapshot, Failure> {
        let (tx, rx) = oneshot::channel();
        self.send(Work::Edit(request, tx))?;
        receive(rx).await
    }
    fn send(&self, work: Work) -> Result<(), Failure> {
        if self.closing.load(Ordering::Acquire) {
            return Err(Failure::new("closing", "The local workspace is closing"));
        }
        // Serialize enqueue with the shutdown marker. No command can enter the
        // queue behind Close after passing an earlier closing-flag check.
        let sender = self.sender.try_lock().map_err(|_| {
            Failure::new(
                "unavailable",
                "Workspace queue is busy; retry the same request",
            )
        })?;
        if self.closing.load(Ordering::Acquire) {
            return Err(Failure::new("closing", "The local workspace is closing"));
        }
        sender.try_send(work).map_err(|e| {
            Failure::new(
                "unavailable",
                format!("Workspace unavailable; reconnect before retrying: {e}"),
            )
        })
    }
    pub fn is_closing(&self) -> bool {
        self.closing.load(Ordering::Acquire)
    }
    /// Run on a blocking task during shutdown; accepted queue entries drain before
    /// SQLite is closed. The second caller must not trigger an early process exit.
    pub fn close(&self) {
        self.closing.store(true, Ordering::Release);
        let mut guard = self.join.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(join) = guard.take() {
            {
                let sender = self.sender.lock().unwrap_or_else(|e| e.into_inner());
                let _ = sender.send(Work::Close);
            }
            let _ = join.join();
        }
    }
}
async fn receive(rx: oneshot::Receiver<Result<Snapshot, Failure>>) -> Result<Snapshot, Failure> {
    rx.await.map_err(|_| {
        Failure::new(
            "unavailable",
            "Workspace stopped before replying; reconnect to check the saved revision",
        )
    })?
}
fn open(path: PathBuf) -> Result<Workspace, Failure> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| Failure::new("storage", e.to_string()))?;
    }
    let song: Song = serde_json::from_str(include_str!("../../../../tests/desktop/fixture.json"))
        .map_err(|e| Failure::new("storage", e.to_string()))?;
    let mut workspace = Workspace::open(path).map_err(Failure::from)?;
    workspace.initialize_fixture(song).map_err(Failure::from)?;
    Ok(workspace)
}
fn run(
    workspace: &mut Workspace,
    request: Option<&EditRequest>,
    epoch: &str,
) -> Result<Snapshot, Failure> {
    if let Some(request) = request {
        if request.protocol != PROTOCOL {
            return Err(Failure::new(
                "protocol",
                "Desktop interface version mismatch",
            ));
        }
        if request.epoch != epoch {
            return Err(Failure::new(
                "session",
                "The local session changed; reconnect before editing",
            ));
        }
        let mutation = Mutation {
            song_id: "desktop-fixture".into(),
            expected_revision: request.expected_revision,
            operation_id: request.operation_id.clone(),
            label: request.label.clone(),
            action: request.action.clone(),
        };
        workspace.dispatch(&mutation).map_err(Failure::from)?;
    }
    let envelope = workspace.read("desktop-fixture").map_err(Failure::from)?;
    Ok(projection::snapshot(&envelope, epoch))
}
