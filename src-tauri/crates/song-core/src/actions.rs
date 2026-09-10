use crate::{
    Error, HarmonyAction, MusicalEvent, Performance, Result, RhythmAction, Song, StructureAction,
    Time, ensure, validate::identity,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Action {
    Rename {
        title: String,
    },
    MoveNote {
        event_id: String,
        member_id: Option<String>,
        start: Time,
    },
    Undo {
        target_id: String,
    },
    Structure {
        action: Box<StructureAction>,
    },
    Rhythm {
        action: Box<RhythmAction>,
    },
    Harmony {
        action: Box<HarmonyAction>,
    },
    Edit {
        changes: Vec<crate::WireChange>,
    },
    Replace {
        song: Box<Song>,
    },
    Delete,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Mutation {
    pub song_id: String,
    pub expected_revision: u64,
    pub operation_id: String,
    pub label: String,
    pub action: Action,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Delta {
    Title {
        before: String,
        after: String,
    },
    Event {
        id: String,
        before: Box<MusicalEvent>,
        after: Box<MusicalEvent>,
    },
    /// Any other table entry (or meta field) as JSON values, mirroring the
    /// reference difference output. Missing entries read as null.
    Table {
        table: String,
        id: String,
        before: Value,
        after: Value,
    },
}

/// JSON numbers compare by value, not spelling: imported receipts spell whole
/// doubles as integers while computed ones spell them as floats.
fn value_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => match (a.as_f64(), b.as_f64()) {
            (Some(a), Some(b)) => a == b,
            _ => a == b,
        },
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b.iter()).all(|(a, b)| value_eq(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, v)| b.get(k).is_some_and(|w| value_eq(v, w)))
        }
        _ => a == b,
    }
}

impl PartialEq for Delta {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (
                Delta::Title {
                    before: a,
                    after: b,
                },
                Delta::Title {
                    before: c,
                    after: d,
                },
            ) => a == c && b == d,
            (
                Delta::Event {
                    id: a,
                    before: b,
                    after: c,
                },
                Delta::Event {
                    id: d,
                    before: e,
                    after: f,
                },
            ) => a == d && b == e && c == f,
            (
                Delta::Table {
                    table: a,
                    id: b,
                    before: c,
                    after: d,
                },
                Delta::Table {
                    table: e,
                    id: f,
                    before: g,
                    after: h,
                },
            ) => a == e && b == f && value_eq(c, g) && value_eq(d, h),
            _ => false,
        }
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Receipt {
    pub operation_id: String,
    /// Typed canonical request equality avoids JSON property-order sensitivity.
    pub mutation: Mutation,
    pub revision: u64,
    pub deltas: Vec<Delta>,
    pub at: u64,
    /// Deletion lifecycle: a receipt that removes the song, restores it, or
    /// neither. Absent on older receipts, which never deleted.
    #[serde(default)]
    pub before_deleted: bool,
    #[serde(default)]
    pub after_deleted: bool,
    #[serde(default)]
    pub deleted_song: Option<Song>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Envelope {
    pub format_version: u32,
    pub revision: u64,
    pub song: Option<Song>,
    pub history: Vec<Receipt>,
}
/// A detached, read-only-by-ownership representation. No mutable model reference escapes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub revision: u64,
    pub song: Option<Song>,
    pub undoable: Vec<String>,
    pub redoable: Vec<String>,
}

/// Minimal receipt view for undo/redo stack computation. Deletion tombstones
/// arrive with delete commands; until then every entry is deletion-unchanged.
#[derive(Debug, Clone, PartialEq)]
pub struct StackEntry {
    pub operation_id: String,
    pub undo_of: Option<String>,
    pub has_deltas: bool,
    pub deletion_unchanged: bool,
}

/// Undo/redo stacks mirroring historyStacks in history.ts. An entry that
/// undoes a redoable operation becomes undoable again and vice versa; any
/// other accepted operation clears the redo stack.
pub fn history_stacks(entries: &[StackEntry]) -> (Vec<String>, Vec<String>) {
    let mut undo = vec![];
    let mut redo = vec![];
    for entry in entries {
        if !entry.has_deltas && entry.deletion_unchanged {
            continue;
        }
        match &entry.undo_of {
            Some(target) if redo.contains(target) => {
                redo.retain(|id| id != target);
                undo.push(entry.operation_id.clone());
            }
            Some(target) if undo.contains(target) => {
                undo.retain(|id| id != target);
                redo.push(entry.operation_id.clone());
            }
            _ => {
                undo.push(entry.operation_id.clone());
                redo.clear();
            }
        }
    }
    (undo, redo)
}

// Proposals are private. External callers cannot submit already-accepted deltas.
struct Proposal {
    song: Option<Song>,
}

// This disposable foundation slice replays history on reopen. Bound that work
// until D2 introduces indexed receipts and verified snapshots for larger projects.
const MAX_FIXTURE_HISTORY: usize = 256;

/// Convert one stored browser receipt. Fingerprints carry the original mutation;
/// undo targets must agree with the replayed action.
fn convert_receipt(value: &Value) -> Result<Receipt> {
    let invalid = |detail: &str| {
        Error::new(
            "invalid",
            format!("Stored receipt cannot be replayed: {detail}"),
        )
    };
    let operation_id = value["operationId"]
        .as_str()
        .ok_or_else(|| invalid("operation id"))?;
    let label = value["label"].as_str().ok_or_else(|| invalid("label"))?;
    let revision = value["revision"]
        .as_u64()
        .ok_or_else(|| invalid("revision"))?;
    let at = value["at"].as_u64().ok_or_else(|| invalid("timestamp"))?;
    let fingerprint = value["fingerprint"]
        .as_str()
        .ok_or_else(|| invalid("fingerprint"))?;
    let request: Value = serde_json::from_str(fingerprint).map_err(|_| invalid("fingerprint"))?;
    let mutation: Mutation = serde_json::from_value(serde_json::json!({
        "songId": request["songId"],
        "expectedRevision": request["expectedRevision"],
        "operationId": request["operationId"],
        "label": request["label"],
        "action": request["command"],
    }))
    .map_err(|_| invalid("mutation"))?;
    ensure(
        mutation.operation_id == operation_id && mutation.label == label,
        "Stored receipt cannot be replayed: operation id",
    )?;
    let undo_of = value["undoOf"].as_str().map(str::to_string);
    match (&mutation.action, &undo_of) {
        (Action::Undo { target_id }, Some(recorded)) => {
            ensure(
                target_id == recorded,
                "Stored receipt cannot be replayed: undo target",
            )?;
        }
        (Action::Undo { .. }, None) => return Err(invalid("undo target")),
        (_, Some(_)) => return Err(invalid("undo target")),
        _ => {}
    }
    let mut deltas = Vec::new();
    for delta in value["deltas"]
        .as_array()
        .ok_or_else(|| invalid("deltas"))?
    {
        let table = delta["table"]
            .as_str()
            .ok_or_else(|| invalid("delta table"))?;
        let id = delta["id"].as_str().ok_or_else(|| invalid("delta id"))?;
        // Boundary transitions carry null-sided deltas; only fully-present
        // title/event deltas take the typed fast path.
        let present = !delta["before"].is_null() && !delta["after"].is_null();
        if table == "meta" && id == "title" && present {
            deltas.push(Delta::Title {
                before: serde_json::from_value(delta["before"].clone())
                    .map_err(|_| invalid("delta title"))?,
                after: serde_json::from_value(delta["after"].clone())
                    .map_err(|_| invalid("delta title"))?,
            });
        } else if table == "events" && present {
            deltas.push(Delta::Event {
                id: id.into(),
                before: Box::new(
                    serde_json::from_value(delta["before"].clone())
                        .map_err(|_| invalid("delta event"))?,
                ),
                after: Box::new(
                    serde_json::from_value(delta["after"].clone())
                        .map_err(|_| invalid("delta event"))?,
                ),
            });
        } else {
            deltas.push(Delta::Table {
                table: table.into(),
                id: id.into(),
                before: delta["before"].clone(),
                after: delta["after"].clone(),
            });
        }
    }
    Ok(Receipt {
        operation_id: operation_id.into(),
        mutation,
        revision,
        deltas: {
            let mut deltas = deltas;
            sort_deltas(&mut deltas);
            deltas
        },
        at,
        before_deleted: value["beforeDeleted"].as_bool().unwrap_or(false),
        after_deleted: value["afterDeleted"].as_bool().unwrap_or(false),
        deleted_song: match value.get("deletedSong") {
            None | Some(Value::Null) => None,
            Some(song) => {
                let migrated = crate::migrate_song(song);
                let song: Song = serde_json::from_value(migrated).map_err(|e| {
                    Error::new(
                        "invalid",
                        format!("Stored deleted song cannot be loaded: {e}"),
                    )
                })?;
                song.validate()?;
                Some(song)
            }
        },
    })
}

impl Envelope {
    pub fn fixture(song: Song) -> Result<Self> {
        song.validate()?;
        Ok(Self {
            format_version: 1,
            revision: 0,
            song: Some(song),
            history: vec![],
        })
    }

    /// Import a stored browser envelope: migrate its song, convert its
    /// receipts, then revalidate everything including replay equality.
    /// Deleted-song envelopes are rejected; import live songs.
    pub fn import(value: &Value) -> Result<Self> {
        let song_value = value
            .get("song")
            .ok_or_else(|| Error::new("invalid", "Imported envelope must be an object"))?;
        if song_value.is_null() {
            return Err(Error::new("invalid", "Imported song is missing"));
        }
        let migrated = crate::migrate_song(song_value);
        let song: Song = serde_json::from_value(migrated)
            .map_err(|e| Error::new("invalid", format!("Stored song cannot be loaded: {e}")))?;
        song.validate()?;
        if let Some(id) = value.get("id").and_then(Value::as_str) {
            ensure(id == song.id, "Stored envelope identity mismatch")?;
        }
        let revision = value["revision"]
            .as_u64()
            .ok_or_else(|| Error::new("invalid", "Stored envelope cannot be loaded: revision"))?;
        let mut history = Vec::new();
        for receipt in value["history"]
            .as_array()
            .ok_or_else(|| Error::new("invalid", "Stored envelope cannot be loaded: history"))?
        {
            history.push(convert_receipt(receipt)?);
        }
        let envelope = Self {
            format_version: 1,
            revision,
            song: Some(song),
            history,
        };
        envelope.validate()?;
        Ok(envelope)
    }

    /// Validate the local envelope as well as the song on reopening. Histories
    /// replay from the genesis song, which may be absent when the first
    /// receipt creates one.
    pub fn validate(&self) -> Result<()> {
        ensure(
            self.history.len() <= MAX_FIXTURE_HISTORY,
            "D1 fixture history limit reached",
        )?;
        ensure(
            self.format_version == 1,
            "Unsupported desktop envelope version",
        )?;
        if let Some(song) = &self.song {
            song.validate()?;
        }
        ensure(
            self.revision <= crate::MAX_SAFE_INTEGER as u64
                && self.history.len() as u64 == self.revision,
            "Invalid desktop history length",
        )?;
        let identity = self
            .song
            .as_ref()
            .map(|song| song.id.clone())
            .or_else(|| self.history.first().map(|r| r.mutation.song_id.clone()));
        let mut ids = std::collections::BTreeSet::new();
        for (i, r) in self.history.iter().enumerate() {
            r.mutation.validate()?;
            ensure(
                r.revision == i as u64 + 1
                    && r.operation_id == r.mutation.operation_id
                    && Some(&r.mutation.song_id) == identity.as_ref()
                    && r.mutation.expected_revision == i as u64
                    && ids.insert(&r.operation_id)
                    && r.at <= crate::MAX_SAFE_INTEGER as u64,
                "Invalid desktop receipt",
            )?;
        }
        // Reverse then replay the recorded actions. Reject corrupted deltas even
        // when their JSON shape is valid; undo must never become a raw write path.
        let mut song = self.song.clone();
        for receipt in self.history.iter().rev() {
            reverse_song(&mut song, receipt)?;
        }
        let mut replay = Self {
            format_version: self.format_version,
            revision: 0,
            song,
            history: vec![],
        };
        for receipt in &self.history {
            replay = replay.accept(&receipt.mutation, receipt.at)?;
            ensure(
                replay.history.last() == Some(receipt),
                "Desktop history does not match its actions",
            )?;
        }
        ensure(
            replay.song == self.song && replay.revision == self.revision,
            "Desktop history does not match its song",
        )
    }

    pub fn state(&self) -> State {
        let (undo, redo) = history_stacks(
            &self
                .history
                .iter()
                .map(|r| StackEntry {
                    operation_id: r.operation_id.clone(),
                    undo_of: match &r.mutation.action {
                        Action::Undo { target_id } => Some(target_id.clone()),
                        _ => None,
                    },
                    has_deltas: !r.deltas.is_empty(),
                    deletion_unchanged: r.before_deleted == r.after_deleted,
                })
                .collect::<Vec<_>>(),
        );
        let reversible = |id: &String| {
            self.history
                .iter()
                .find(|r| &r.operation_id == id)
                .is_some_and(|r| {
                    let mut candidate = self.song.clone();
                    reverse_song(&mut candidate, r).is_ok()
                })
        };
        State {
            revision: self.revision,
            song: self.song.clone(),
            undoable: undo.into_iter().filter(|id| reversible(id)).collect(),
            redoable: redo.into_iter().filter(|id| reversible(id)).collect(),
        }
    }

    /// A pure SAM acceptance step. The workspace persists the returned candidate
    /// before exposing it. No I/O, task loop or audio callback lives here.
    pub fn accept(&self, m: &Mutation, now: u64) -> Result<Self> {
        m.validate()?;
        let identity = self
            .song
            .as_ref()
            .map(|song| song.id.clone())
            .or_else(|| self.history.first().map(|r| r.mutation.song_id.clone()));
        if let Some(identity) = identity {
            ensure(
                m.song_id == identity,
                "Song identity does not match workspace",
            )?;
        }
        if let Some(receipt) = self
            .history
            .iter()
            .find(|r| r.operation_id == m.operation_id)
        {
            if receipt.mutation != *m {
                return Err(Error::new(
                    "operation_reused",
                    "Operation ID reused with different content",
                ));
            }
            return Ok(self.clone());
        }
        if m.expected_revision != self.revision {
            return Err(Error::new(
                "conflict",
                format!(
                    "Revision conflict: expected {}, current {}. Refresh before editing.",
                    m.expected_revision, self.revision
                ),
            ));
        }
        ensure(
            self.history.len() < MAX_FIXTURE_HISTORY,
            "D1 fixture history limit reached",
        )?;
        ensure(
            self.revision < crate::MAX_SAFE_INTEGER as u64 && now <= crate::MAX_SAFE_INTEGER as u64,
            "Revision or timestamp exceeds exact bounds",
        )?;
        let mut proposal = propose(self, &m.action)?;
        // Mirror applyCommand: a chord whose notes changed under an unchanged
        // label loses the stale label.
        if let (Some(before), Some(after)) = (self.song.as_ref(), proposal.song.as_mut()) {
            for (id, chord) in after.tables.chords.iter_mut() {
                if let Some(old) = before.tables.chords.get(id)
                    && old.notes != chord.notes
                    && old.label == chord.label
                {
                    chord.label = None;
                }
            }
        }
        if let Some(song) = &proposal.song {
            song.validate()?;
        }
        let mut candidate = self.clone();
        candidate.revision += 1;
        candidate.song = proposal.song;
        let before_deleted = self.song.is_none();
        let after_deleted = candidate.song.is_none();
        candidate.history.push(Receipt {
            operation_id: m.operation_id.clone(),
            mutation: m.clone(),
            revision: candidate.revision,
            deltas: difference_opt(self.song.as_ref(), candidate.song.as_ref())?,
            at: now,
            before_deleted,
            after_deleted,
            deleted_song: if after_deleted && !before_deleted {
                self.song.clone()
            } else {
                None
            },
        });
        Ok(candidate)
    }
}

/// Table and meta differences as generic deltas, mirroring the reference
/// difference output. Title and note edits keep their typed variants; every
/// other change (including arrangement order) becomes a table delta.
fn difference(before: &Song, after: &Song) -> Result<Vec<Delta>> {
    let mut deltas = vec![];
    if before.title != after.title {
        deltas.push(Delta::Title {
            before: before.title.clone(),
            after: after.title.clone(),
        });
    }
    macro_rules! table {
        ($field:ident, $name:literal) => {
            for id in before
                .tables
                .$field
                .keys()
                .chain(after.tables.$field.keys())
                .collect::<std::collections::BTreeSet<_>>()
            {
                let convert = |song: &Song| {
                    song.tables.$field.get(id).map(|e| {
                        serde_json::to_value(e).map_err(|e| {
                            Error::new("invalid", format!("Unserializable entity: {e}"))
                        })
                    })
                };
                let b = convert(before).transpose()?.unwrap_or(Value::Null);
                let a = convert(after).transpose()?.unwrap_or(Value::Null);
                if b != a {
                    deltas.push(Delta::Table {
                        table: $name.into(),
                        id: (*id).clone(),
                        before: b,
                        after: a,
                    });
                }
            }
        };
    }
    // Events keep typed deltas when both sides exist; additions and removals
    // travel as table deltas so undo never indexes a missing entry.
    for (id, after_event) in &after.tables.events {
        match before.tables.events.get(id) {
            Some(before_event) if before_event != after_event => {
                deltas.push(Delta::Event {
                    id: id.clone(),
                    before: Box::new(before_event.clone()),
                    after: Box::new(after_event.clone()),
                });
            }
            None => {
                deltas.push(Delta::Table {
                    table: "events".into(),
                    id: id.clone(),
                    before: Value::Null,
                    after: serde_json::to_value(after_event)?,
                });
            }
            _ => {}
        }
    }
    for (id, before_event) in &before.tables.events {
        if !after.tables.events.contains_key(id) {
            deltas.push(Delta::Table {
                table: "events".into(),
                id: id.clone(),
                before: serde_json::to_value(before_event)?,
                after: Value::Null,
            });
        }
    }
    table!(patterns, "patterns");
    table!(chords, "chords");
    table!(bars, "bars");
    table!(sections, "sections");
    table!(arrangement, "arrangement");
    table!(parts, "parts");
    table!(voices, "voices");
    table!(occurrences, "occurrences");
    table!(prompts, "prompts");
    table!(assets, "assets");
    table!(takes, "takes");
    table!(fretted, "fretted");
    table!(fingerings, "fingerings");
    table!(harmony, "harmony");
    table!(markers, "markers");
    table!(phrases, "phrases");
    table!(lyrics, "lyrics");
    table!(polyrhythms, "polyrhythms");
    if before.arrangement_order != after.arrangement_order {
        deltas.push(Delta::Table {
            table: "meta".into(),
            id: "arrangementOrder".into(),
            before: Value::Array(
                before
                    .arrangement_order
                    .iter()
                    .map(|id| Value::String(id.clone()))
                    .collect(),
            ),
            after: Value::Array(
                after
                    .arrangement_order
                    .iter()
                    .map(|id| Value::String(id.clone()))
                    .collect(),
            ),
        });
    }
    sort_deltas(&mut deltas);
    Ok(deltas)
}

/// Canonical delta order so replayed receipts compare equal regardless of
/// which side produced them first.
fn sort_deltas(deltas: &mut [Delta]) {
    deltas.sort_by_key(|delta| match delta {
        Delta::Title { .. } => ("meta".to_string(), "title".to_string()),
        Delta::Event { id, .. } => ("events".to_string(), id.clone()),
        Delta::Table { table, id, .. } => (table.clone(), id.clone()),
    });
}

/// Differences across the deletion boundary. Creations and deletions expand
/// to per-field table deltas, mirroring the reference difference output.
fn difference_opt(before: Option<&Song>, after: Option<&Song>) -> Result<Vec<Delta>> {
    match (before, after) {
        (Some(before), Some(after)) => difference(before, after),
        (Some(song), None) => {
            let mut deltas = vec![Delta::Table {
                table: "meta".into(),
                id: "title".into(),
                before: Value::String(song.title.clone()),
                after: Value::Null,
            }];
            for table in ["writing", "mode", "tempo", "arrangementOrder"] {
                let value = match table {
                    "writing" => serde_json::to_value(&song.writing)?,
                    "mode" => Value::String(song.mode.clone()),
                    "tempo" => serde_json::to_value(&song.tempo)?,
                    _ => Value::Array(
                        song.arrangement_order
                            .iter()
                            .map(|id| Value::String(id.clone()))
                            .collect(),
                    ),
                };
                deltas.push(Delta::Table {
                    table: "meta".into(),
                    id: table.into(),
                    before: value,
                    after: Value::Null,
                });
            }
            let tables = serde_json::to_value(&song.tables)?;
            for (table, entries) in tables.as_object().unwrap() {
                for (id, before) in entries.as_object().unwrap() {
                    deltas.push(Delta::Table {
                        table: table.clone(),
                        id: id.clone(),
                        before: before.clone(),
                        after: Value::Null,
                    });
                }
            }
            sort_deltas(&mut deltas);
            Ok(deltas)
        }
        (None, Some(song)) => {
            let created = difference_opt(Some(song), None)?;
            Ok(created
                .into_iter()
                .map(|delta| match delta {
                    Delta::Table {
                        table,
                        id,
                        before,
                        after,
                    } => Delta::Table {
                        table,
                        id,
                        before: after,
                        after: before,
                    },
                    other => other,
                })
                .collect())
        }
        (None, None) => Ok(vec![]),
    }
}

impl Mutation {
    fn validate(&self) -> Result<()> {
        ensure(
            identity(&self.song_id)
                && identity(&self.operation_id)
                && !self.label.is_empty()
                && self.label.encode_utf16().count() <= 10000
                && self.expected_revision <= crate::MAX_SAFE_INTEGER as u64,
            "Invalid mutation: identity, revision, label and command are required",
        )
    }
}

const META_FIELDS: [&str; 5] = ["writing", "title", "mode", "tempo", "arrangementOrder"];

/// One generic table write mirroring the reference write path. Well-typed
/// values behave identically; malformed wire values fail here with serde
/// messages instead of later validation messages.
fn apply_change(song: &mut Song, change: &crate::WireChange) -> Result<()> {
    if change.table == "meta" {
        ensure(
            META_FIELDS.contains(&change.id.as_str()),
            &format!("Cannot edit metadata {}", change.id),
        )?;
        match change.id.as_str() {
            "title" => {
                song.title = serde_json::from_value(change.value.clone())?;
            }
            "mode" => {
                song.mode = serde_json::from_value(change.value.clone())?;
            }
            "writing" => {
                song.writing = serde_json::from_value(change.value.clone())?;
            }
            "tempo" => {
                song.tempo = serde_json::from_value(change.value.clone())?;
            }
            "arrangementOrder" => {
                song.arrangement_order = serde_json::from_value(change.value.clone())?;
            }
            _ => unreachable!(),
        }
        return Ok(());
    }
    ensure(
        KNOWN_TABLES.contains(&change.table.as_str()),
        "Invalid entity path",
    )?;
    ensure(
        !["__proto__", "constructor", "prototype"].contains(&change.id.as_str()),
        "Invalid entity path",
    )?;
    write_table_slot(song, &change.table, &change.id, &change.value)
}

fn propose(current: &Envelope, action: &Action) -> Result<Proposal> {
    match action {
        Action::Replace { song } => {
            let expected = current
                .song
                .as_ref()
                .map(|song| song.id.as_str())
                .or_else(|| current.history.first().map(|r| r.mutation.song_id.as_str()));
            if let Some(expected) = expected {
                ensure(song.id == expected, "Imported song ID must match target")?;
            }
            return Ok(Proposal {
                song: Some(song.as_ref().clone()),
            });
        }
        Action::Delete => {
            return Ok(Proposal { song: None });
        }
        _ => {}
    }
    let mut song = current.song.clone();
    if let Action::Undo { target_id } = action {
        let receipt = current
            .history
            .iter()
            .find(|r| &r.operation_id == target_id)
            .ok_or_else(|| Error::new("invalid", "Unknown change to undo"))?;
        reverse_song(&mut song, receipt)?;
        return Ok(Proposal { song });
    }
    let mut song = song.ok_or_else(|| Error::new("missing", "Song does not exist"))?;
    match action {
        Action::Rename { title } => song.title = title.clone(),
        Action::MoveNote {
            event_id,
            member_id,
            start,
        } => move_note(&mut song, event_id, member_id.as_deref(), *start)?,
        Action::Structure { action } => crate::structure::structure(&mut song, action)?,
        Action::Rhythm { action } => crate::rhythm::rhythm(&mut song, action)?,
        Action::Harmony { action } => crate::harmony::harmony(&mut song, action)?,
        Action::Edit { changes } => {
            for change in changes {
                apply_change(&mut song, change)?;
            }
        }
        Action::Replace { .. } | Action::Delete | Action::Undo { .. } => unreachable!(),
    }
    Ok(Proposal { song: Some(song) })
}

fn move_note(song: &mut Song, event_id: &str, member_id: Option<&str>, start: Time) -> Result<()> {
    let e = song
        .tables
        .events
        .get_mut(event_id)
        .ok_or_else(|| Error::new("invalid", "The selected note no longer exists"))?;
    let Some(member_id) = member_id else {
        ensure(e.kind == "note", "Select an individual pitched note")?;
        e.start = start;
        return Ok(());
    };
    ensure(e.kind == "chord", "The selected chord changed")?;
    let c = e
        .chord_id
        .as_ref()
        .and_then(|id| song.tables.chords.get(id))
        .ok_or_else(|| Error::new("invalid", "The selected chord changed"))?;
    ensure(
        c.notes.iter().any(|n| n.id == member_id),
        "The chord member no longer exists",
    )?;
    let index = if let Some(index) = e.performance.iter().position(|p| p.member_id == member_id) {
        index
    } else {
        e.performance.push(Performance {
            member_id: member_id.into(),
            offset: Time::ZERO,
            duration: e.duration,
            gain: None,
            articulation: None,
        });
        e.performance.len() - 1
    };
    e.performance[index].offset = start.checked_sub(e.start)?;
    let shift = e.performance[index].offset;
    if shift < Time::ZERO {
        for n in &c.notes {
            if !e.performance.iter().any(|p| p.member_id == n.id) {
                e.performance.push(Performance {
                    member_id: n.id.clone(),
                    offset: Time::ZERO,
                    duration: e.duration,
                    gain: None,
                    articulation: None,
                });
            }
        }
        e.start = e.start.checked_add(shift)?;
        for p in &mut e.performance {
            p.offset = p.offset.checked_sub(shift)?;
        }
    }
    Ok(())
}

fn reverse(song: &mut Song, deltas: &[Delta]) -> Result<()> {
    for delta in deltas {
        let (matches, path) = match delta {
            Delta::Title { after, .. } => (song.title == *after, "meta/title".into()),
            Delta::Event { id, after, .. } => (
                song.tables.events.get(id) == Some(after.as_ref()),
                format!("events/{id}"),
            ),
            Delta::Table {
                table, id, after, ..
            } => (
                table_slot(song, table, id)? == *after,
                format!("{table}/{id}"),
            ),
        };
        if !matches {
            return Err(Error::new(
                "undo_conflict",
                format!("Undo conflict at {path}: changed since this operation"),
            ));
        }
    }
    for delta in deltas {
        match delta {
            Delta::Title { before, .. } => song.title = before.clone(),
            Delta::Event { id, before, .. } => {
                song.tables
                    .events
                    .insert(id.clone(), before.as_ref().clone());
            }
            Delta::Table {
                table, id, before, ..
            } => write_table_slot(song, table, id, before)?,
        }
    }
    Ok(())
}

/// Current table entry as JSON (missing reads as null), mirroring the
/// reference difference output for undo comparison.
fn table_slot(song: &Song, table: &str, id: &str) -> Result<Value> {
    if table == "meta" {
        return match id {
            "arrangementOrder" => Ok(Value::Array(
                song.arrangement_order
                    .iter()
                    .map(|id| Value::String(id.clone()))
                    .collect(),
            )),
            _ => Err(Error::new(
                "invalid",
                format!("Unsupported metadata slot: {id}"),
            )),
        };
    }
    let v = serde_json::to_value(song)
        .map_err(|e| Error::new("invalid", format!("Unserializable song: {e}")))?;
    Ok(v["tables"][table][id].clone())
}

const KNOWN_TABLES: [&str; 19] = [
    "patterns",
    "events",
    "chords",
    "bars",
    "sections",
    "arrangement",
    "parts",
    "voices",
    "occurrences",
    "prompts",
    "assets",
    "takes",
    "fretted",
    "fingerings",
    "harmony",
    "markers",
    "phrases",
    "lyrics",
    "polyrhythms",
];

/// Write one table delta back. Corrupt values fail instead of mutating.
fn write_table_slot(song: &mut Song, table: &str, id: &str, value: &Value) -> Result<()> {
    if table == "meta" {
        if id == "arrangementOrder" {
            let Value::Array(items) = value else {
                return Err(Error::new("invalid", "Corrupt arrangement order"));
            };
            let mut order = Vec::with_capacity(items.len());
            for item in items {
                order.push(
                    item.as_str()
                        .ok_or_else(|| Error::new("invalid", "Corrupt arrangement order"))?
                        .to_string(),
                );
            }
            song.arrangement_order = order;
            return Ok(());
        }
        return Err(Error::new(
            "invalid",
            format!("Unsupported metadata slot: {id}"),
        ));
    }
    ensure(
        KNOWN_TABLES.contains(&table),
        &format!("Unknown table: {table}"),
    )?;
    let mut v = serde_json::to_value(&*song)
        .map_err(|e| Error::new("invalid", format!("Unserializable song: {e}")))?;
    if value.is_null() {
        if let Some(map) = v["tables"][table].as_object_mut() {
            map.remove(id);
        }
    } else {
        v["tables"][table][id] = value.clone();
    }
    *song = serde_json::from_value(v)
        .map_err(|e| Error::new("invalid", format!("Corrupt table delta: {e}")))?;
    Ok(())
}

/// Reverse one receipt against the deletion boundary. Creation receipts expect
/// a deleted song and leave one behind; deletion receipts require a deleted
/// song and restore the saved one; ordinary receipts reverse into live music.
fn reverse_song(song: &mut Option<Song>, receipt: &Receipt) -> Result<()> {
    if receipt.before_deleted {
        let created = difference_opt(None, song.as_ref())?;
        ensure(
            created == receipt.deltas,
            "Undo conflict: created song has newer edits",
        )?;
        *song = None;
        return Ok(());
    }
    if receipt.after_deleted {
        ensure(song.is_none(), "Undo conflict: song has been restored")?;
        *song = receipt.deleted_song.clone();
        return Ok(());
    }
    let live = song
        .as_mut()
        .ok_or_else(|| Error::new("missing", "Song does not exist"))?;
    reverse(live, &receipt.deltas)
}
