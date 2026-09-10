pub mod agent;
mod projection;
pub mod protocol;
use protocol::{EditRequest, Failure, PROTOCOL, ProfileView, Snapshot};
use song_core::{Mutation, Song};
use song_workspace::Workspace;
use std::{
    fs::{File, OpenOptions},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::oneshot;

type Reply = oneshot::Sender<Result<Snapshot, Failure>>;
enum Work {
    Read(Reply),
    Song(oneshot::Sender<Result<(Song, u64), Failure>>),
    Edit(EditRequest, Reply),
    Agent(
        agent::AgentWork,
        oneshot::Sender<Result<Option<agent::Task>, Failure>>,
    ),
    Profiles(oneshot::Sender<Result<Vec<ProfileView>, Failure>>),
    CreateProfile {
        id: String,
        reply: oneshot::Sender<Result<ProfileView, Failure>>,
    },
    SwitchProfile {
        id: String,
        reply: Reply,
    },
    ProfileId(oneshot::Sender<Result<String, Failure>>),
    Close,
}

pub const DEFAULT_PROFILE: &str = "default";
const MAX_BACKUPS: usize = 8;

fn invalid_profile(id: &str) -> Result<(), Failure> {
    if !id.is_empty()
        && id.len() <= 100
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        Ok(())
    } else {
        Err(Failure::new(
            "invalid",
            "Profile ID must be 1–100 letters, digits, underscores or hyphens",
        ))
    }
}

fn profile_dir(root: &Path, id: &str) -> Result<PathBuf, Failure> {
    invalid_profile(id)?;
    Ok(root.join(id))
}

/// Open one profile: take its OS lock, open its store, seed and recover.
/// The lock releases when the returned file drops.
fn open_profile(root: &Path, id: &str) -> Result<(Workspace, File), Failure> {
    let dir = profile_dir(root, id)?;
    std::fs::create_dir_all(&dir).map_err(|e| Failure::new("storage", e.to_string()))?;
    std::fs::create_dir_all(dir.join("media"))
        .map_err(|e| Failure::new("storage", e.to_string()))?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(dir.join("profile.lock"))
        .map_err(|e| Failure::new("storage", e.to_string()))?;
    lock.try_lock().map_err(|_| {
        Failure::new(
            "locked",
            "Profile is already open in another host; stop that host first",
        )
    })?;
    let song: Song = serde_json::from_str(include_str!("../../../../tests/desktop/fixture.json"))
        .map_err(|e| Failure::new("storage", e.to_string()))?;
    let mut workspace = Workspace::open(dir.join("workspace.sqlite")).map_err(Failure::from)?;
    workspace.initialize_fixture(song).map_err(Failure::from)?;
    workspace.agent_recover().map_err(Failure::from)?;
    Ok((workspace, lock))
}

/// Copy a quiesced profile database aside, keeping a bounded history.
fn backup_profile(root: &Path, id: &str) -> Result<(), Failure> {
    let dir = root.join(id);
    let source = dir.join("workspace.sqlite");
    if !source.is_file() {
        return Ok(());
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| Failure::new("storage", e.to_string()))?
        .as_millis();
    let backups = dir.join("backups");
    std::fs::create_dir_all(&backups).map_err(|e| Failure::new("storage", e.to_string()))?;
    for suffix in ["", "-wal", "-shm"] {
        let file = PathBuf::from(format!("workspace.sqlite{suffix}"));
        if dir.join(&file).is_file() {
            std::fs::copy(
                dir.join(&file),
                backups.join(format!("{stamp}.sqlite{suffix}")),
            )
            .map_err(|e| Failure::new("storage", e.to_string()))?;
        }
    }
    let mut kept: Vec<_> = std::fs::read_dir(&backups)
        .map_err(|e| Failure::new("storage", e.to_string()))?
        .filter_map(|entry| entry.ok().map(|e| e.file_name()))
        .collect();
    kept.sort();
    kept.reverse();
    for stale in kept.into_iter().skip(MAX_BACKUPS) {
        let _ = std::fs::remove_file(backups.join(&stale));
        let stem = stale.to_string_lossy().into_owned();
        for suffix in ["-wal", "-shm"] {
            let _ = std::fs::remove_file(backups.join(format!("{stem}{suffix}")));
        }
    }
    Ok(())
}

fn read_profile(root: &Path, id: &str) -> ProfileView {
    let view = ProfileView {
        id: id.into(),
        title: None,
        revision: None,
    };
    let path = root.join(id).join("workspace.sqlite");
    let connection = match rusqlite::Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) {
        Ok(connection) => connection,
        Err(_) => return view,
    };
    let row: Option<(i64, String)> = connection
        .query_row(
            "SELECT revision, envelope FROM workspace LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    match row {
        Some((revision, data)) => {
            let envelope: Result<song_core::Envelope, _> = serde_json::from_str(&data);
            match envelope {
                Ok(envelope) => ProfileView {
                    title: envelope.song.map(|song| song.title),
                    revision: u64::try_from(revision).ok(),
                    ..view
                },
                Err(_) => view,
            }
        }
        None => view,
    }
}

/// One serialized workspace worker per app, outside the Tauri/UI runtime.
pub struct Session {
    sender: Mutex<mpsc::SyncSender<Work>>,
    closing: AtomicBool,
    join: Mutex<Option<thread::JoinHandle<()>>>,
}
impl Session {
    pub fn start(root: PathBuf, changed: impl Fn(Snapshot) + Send + 'static) -> Arc<Self> {
        let (sender, receiver) = mpsc::sync_channel(32);
        let join = thread::spawn(move || {
            let mut epoch = uuid::Uuid::new_v4().to_string();
            let mut profile = DEFAULT_PROFILE.to_string();
            let (mut workspace, mut lock) = match open_profile(&root, &profile) {
                Ok((workspace, lock)) => (Ok(workspace), Some(lock)),
                Err(error) => (Err(error), None),
            };
            while let Ok(work) = receiver.recv() {
                let (request, reply) = match work {
                    Work::Agent(work, reply) => {
                        let is_tool = matches!(work, agent::AgentWork::Tool { .. });
                        let result = match workspace.as_mut() {
                            Err(e) => Err(e.clone()),
                            Ok(w) => agent::run(w, work).map_err(Failure::from),
                        };
                        if is_tool
                            && result.is_ok()
                            && let Ok(w) = workspace.as_mut()
                            && let Ok(snapshot) = run(w, None, &epoch, &profile)
                        {
                            changed(snapshot);
                        }
                        let _ = reply.send(result);
                        continue;
                    }
                    Work::Song(reply) => {
                        let result = match workspace.as_mut() {
                            Err(e) => Err(e.clone()),
                            Ok(w) => {
                                w.read("desktop-fixture")
                                    .map_err(Failure::from)
                                    .and_then(|e| {
                                        e.song.map(|song| (song, e.revision)).ok_or_else(|| {
                                            Failure::new("missing", "Song does not exist")
                                        })
                                    })
                            }
                        };
                        let _ = reply.send(result);
                        continue;
                    }
                    Work::Profiles(reply) => {
                        let _ = reply.send(Ok(list_profiles(&root)));
                        continue;
                    }
                    Work::CreateProfile { id, reply } => {
                        let _ = reply.send(create_profile(&root, &id));
                        continue;
                    }
                    Work::SwitchProfile { id, reply } => {
                        let result = switch_profile(
                            &root,
                            &mut profile,
                            &mut epoch,
                            &mut workspace,
                            &mut lock,
                            &id,
                        );
                        let _ = reply.send(result);
                        continue;
                    }
                    Work::ProfileId(reply) => {
                        let _ = reply.send(Ok(profile.clone()));
                        continue;
                    }
                    Work::Read(r) => (None, r),
                    Work::Edit(m, r) => (Some(m), r),
                    Work::Close => break,
                };
                let result = match workspace.as_mut() {
                    Err(e) => Err(e.clone()),
                    Ok(workspace) => run(workspace, request.as_ref(), &epoch, &profile),
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
    /// Committed musical input for native workers; not a renderer write surface.
    pub async fn song(&self) -> Result<(Song, u64), Failure> {
        let (tx, rx) = oneshot::channel();
        self.send(Work::Song(tx))?;
        rx.await
            .map_err(|_| Failure::new("unavailable", "Workspace stopped"))?
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
    pub async fn profiles(&self) -> Result<Vec<ProfileView>, Failure> {
        let (tx, rx) = oneshot::channel();
        self.send(Work::Profiles(tx))?;
        rx.await
            .map_err(|_| Failure::new("unavailable", "Workspace stopped"))?
    }
    pub async fn create_profile(&self, id: String) -> Result<ProfileView, Failure> {
        let (tx, rx) = oneshot::channel();
        self.send(Work::CreateProfile { id, reply: tx })?;
        rx.await
            .map_err(|_| Failure::new("unavailable", "Workspace stopped"))?
    }
    pub async fn switch_profile(&self, id: String) -> Result<Snapshot, Failure> {
        let (tx, rx) = oneshot::channel();
        self.send(Work::SwitchProfile { id, reply: tx })?;
        receive(rx).await
    }
    pub async fn profile_id(&self) -> Result<String, Failure> {
        let (tx, rx) = oneshot::channel();
        self.send(Work::ProfileId(tx))?;
        rx.await
            .map_err(|_| Failure::new("unavailable", "Workspace stopped"))?
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

fn list_profiles(root: &Path) -> Vec<ProfileView> {
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let id = entry.file_name().to_string_lossy().into_owned();
        if entry.path().join("workspace.sqlite").is_file() && invalid_profile(&id).is_ok() {
            out.push(read_profile(root, &id));
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

fn create_profile(root: &Path, id: &str) -> Result<ProfileView, Failure> {
    invalid_profile(id)?;
    if root.join(id).join("workspace.sqlite").is_file() {
        return Err(Failure::new("conflict", "Profile already exists"));
    }
    let (workspace, _lock) = open_profile(root, id)?;
    drop(workspace);
    Ok(read_profile(root, id))
}

/// Switch the worker to another profile, fencing stale epochs. The epoch only
/// advances on success; a failed switch leaves the current profile untouched.
#[allow(clippy::too_many_arguments)]
fn switch_profile(
    root: &Path,
    profile: &mut String,
    epoch: &mut String,
    workspace: &mut Result<Workspace, Failure>,
    lock: &mut Option<File>,
    id: &str,
) -> Result<Snapshot, Failure> {
    invalid_profile(id)?;
    if id == profile {
        return run_workspace_snapshot(workspace, epoch, profile);
    }
    if !root.join(id).join("workspace.sqlite").is_file() {
        return Err(Failure::new("missing", "Profile does not exist"));
    }
    // Probe the target lock before disturbing the current profile.
    {
        let dir = root.join(id);
        let probe = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(dir.join("profile.lock"))
            .map_err(|e| Failure::new("storage", e.to_string()))?;
        probe.try_lock().map_err(|_| {
            Failure::new(
                "locked",
                "Profile is already open in another host; stop that host first",
            )
        })?;
    }
    backup_profile(root, profile)?;
    *workspace = Err(Failure::new("storage", "switching profiles"));
    *lock = None;
    match open_profile(root, id) {
        Ok((next, next_lock)) => {
            *workspace = Ok(next);
            *lock = Some(next_lock);
            *profile = id.into();
            *epoch = uuid::Uuid::new_v4().to_string();
            run_workspace_snapshot(workspace, epoch, profile)
        }
        Err(error) => {
            // Best effort: reopen the previous profile on its old epoch.
            if let Ok((restored, restored_lock)) = open_profile(root, profile) {
                *workspace = Ok(restored);
                *lock = Some(restored_lock);
            }
            Err(error)
        }
    }
}

fn run_workspace_snapshot(
    workspace: &mut Result<Workspace, Failure>,
    epoch: &str,
    profile: &str,
) -> Result<Snapshot, Failure> {
    match workspace.as_mut() {
        Err(e) => Err(e.clone()),
        Ok(workspace) => run(workspace, None, epoch, profile),
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

fn run(
    workspace: &mut Workspace,
    request: Option<&EditRequest>,
    epoch: &str,
    profile: &str,
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
    Ok(projection::snapshot(&envelope, epoch, profile))
}

async fn receive_task(
    rx: oneshot::Receiver<Result<Option<agent::Task>, Failure>>,
) -> Result<Option<agent::Task>, Failure> {
    rx.await.map_err(|_| {
        Failure::new(
            "unavailable",
            "Workspace stopped; reconnect to inspect the durable task",
        )
    })?
}
