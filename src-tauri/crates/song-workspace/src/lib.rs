pub mod agent;
// Single-owner, synchronous persistence adapter. The future Tauri host must run
// this on its workspace worker, never its UI thread or audio callback.
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use song_core::{Envelope, Error, Mutation, Result, Song, State};
use std::{
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub struct Workspace {
    connection: Connection,
}
const APPLICATION_ID: i32 = 0x53574431;

fn storage(error: impl std::fmt::Display) -> Error {
    Error::new("storage", error.to_string())
}

impl Workspace {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let mut connection = Connection::open(path).map_err(storage)?;
        connection
            .busy_timeout(Duration::from_secs(2))
            .map_err(storage)?;
        // Claim only a new, empty database. Never migrate another application's DB.
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let app: i32 = tx
            .pragma_query_value(None, "application_id", |r| r.get(0))
            .map_err(storage)?;
        let version: i32 = tx
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(storage)?;
        if app == 0 && version == 0 {
            let tables: i64 = tx
                .query_row(
                    "SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",
                    [],
                    |r| r.get(0),
                )
                .map_err(storage)?;
            if tables != 0 {
                return Err(Error::new(
                    "storage",
                    "Refusing to initialize a nonempty unknown database",
                ));
            }
            tx.execute_batch("CREATE TABLE workspace (id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision >= 0), envelope TEXT NOT NULL);").map_err(storage)?;
            tx.pragma_update(None, "application_id", APPLICATION_ID)
                .map_err(storage)?;
            tx.pragma_update(None, "user_version", 1).map_err(storage)?;
        } else if app != APPLICATION_ID || !(1..=2).contains(&version) {
            return Err(Error::new(
                "storage",
                "Unsupported desktop database identity or version",
            ));
        }
        if version < 2 {
            tx.execute_batch("CREATE TABLE agent_tasks (id TEXT PRIMARY KEY, task TEXT NOT NULL);")
                .map_err(storage)?;
            tx.pragma_update(None, "user_version", 2).map_err(storage)?;
        }
        tx.commit().map_err(storage)?;
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(storage)?;
        connection
            .pragma_update(None, "synchronous", "FULL")
            .map_err(storage)?;
        Ok(Self { connection })
    }

    /// D1 fixture bootstrap, not a general import or edit tool. Existing music is
    /// never replaced. Both the seed and any existing record must validate.
    pub fn initialize_fixture(&mut self, song: Song) -> Result<State> {
        let candidate = Envelope::fixture(song)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let current = load(&tx, &candidate.song.id)?;
        let state = if let Some(current) = current {
            current.state()
        } else {
            tx.execute(
                "INSERT INTO workspace (id, revision, envelope) VALUES (?1, 0, ?2)",
                params![
                    candidate.song.id,
                    serde_json::to_string(&candidate).map_err(storage)?
                ],
            )
            .map_err(storage)?;
            candidate.state()
        };
        tx.commit().map_err(storage)?;
        Ok(state)
    }

    pub fn read(&self, id: &str) -> Result<Envelope> {
        load(&self.connection, id)?.ok_or_else(|| Error::new("missing", "Song does not exist"))
    }

    pub fn dispatch(&mut self, mutation: &Mutation) -> Result<State> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let state = apply(&tx, mutation)?;
        tx.commit().map_err(storage)?;
        Ok(state)
    }
}

/// Shared musical path for both UI dispatch and journaled agent tools. The caller
/// may add a task result to the transaction before committing, but cannot bypass
/// acceptance or publish a candidate before that commit succeeds.
fn apply(tx: &rusqlite::Transaction<'_>, mutation: &Mutation) -> Result<State> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(storage)?
        .as_millis();
    let now = u64::try_from(now).map_err(storage)?;
    let before =
        load(tx, &mutation.song_id)?.ok_or_else(|| Error::new("missing", "Song does not exist"))?;
    let candidate = before.accept(mutation, now)?;
    if candidate.revision != before.revision {
        let changed = tx
            .execute(
                "UPDATE workspace SET revision = ?1, envelope = ?2 WHERE id = ?3 AND revision = ?4",
                params![
                    i64::try_from(candidate.revision).map_err(storage)?,
                    serde_json::to_string(&candidate).map_err(storage)?,
                    mutation.song_id,
                    i64::try_from(before.revision).map_err(storage)?
                ],
            )
            .map_err(storage)?;
        if changed != 1 {
            return Err(Error::new("conflict", "Workspace changed while saving"));
        }
    }
    Ok(candidate.state())
}

fn load(connection: &Connection, id: &str) -> Result<Option<Envelope>> {
    let row: Option<(i64, String)> = connection
        .query_row(
            "SELECT revision, envelope FROM workspace WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(storage)?;
    row.map(|(revision, data)| {
        let envelope: Envelope = serde_json::from_str(&data).map_err(storage)?;
        if envelope.song.id != id || i64::try_from(envelope.revision).map_err(storage)? != revision
        {
            return Err(Error::new(
                "storage",
                "Stored envelope identity/revision mismatch",
            ));
        }
        envelope.validate()?;
        Ok(envelope)
    })
    .transpose()
}
