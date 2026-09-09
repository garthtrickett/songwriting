use crate::{Error, MusicalEvent, Performance, Result, Song, Time, ensure, validate::identity};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Envelope {
    pub format_version: u32,
    pub revision: u64,
    pub song: Song,
    pub history: Vec<Receipt>,
}
/// A detached, read-only-by-ownership representation. No mutable model reference escapes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub revision: u64,
    pub song: Song,
    pub undoable: Vec<String>,
}

// Proposals are private. External callers cannot submit already-accepted deltas.
struct Proposal {
    song: Song,
}

// This disposable foundation slice replays history on reopen. Bound that work
// until D2 introduces indexed receipts and verified snapshots for larger projects.
const MAX_FIXTURE_HISTORY: usize = 256;

impl Envelope {
    pub fn fixture(song: Song) -> Result<Self> {
        song.validate()?;
        Ok(Self {
            format_version: 1,
            revision: 0,
            song,
            history: vec![],
        })
    }

    /// Validate the local envelope as well as the song on reopening. This is a new
    /// D1 envelope, intentionally not an importer for legacy browser receipts.
    pub fn validate(&self) -> Result<()> {
        ensure(
            self.history.len() <= MAX_FIXTURE_HISTORY,
            "D1 fixture history limit reached",
        )?;
        ensure(
            self.format_version == 1,
            "Unsupported desktop envelope version",
        )?;
        self.song.validate()?;
        ensure(
            self.revision <= crate::MAX_SAFE_INTEGER as u64
                && self.history.len() as u64 == self.revision,
            "Invalid desktop history length",
        )?;
        let mut ids = std::collections::BTreeSet::new();
        for (i, r) in self.history.iter().enumerate() {
            r.mutation.validate()?;
            ensure(
                r.revision == i as u64 + 1
                    && r.operation_id == r.mutation.operation_id
                    && r.mutation.song_id == self.song.id
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
            reverse(&mut song, &receipt.deltas)?;
        }
        let mut replay = Self::fixture(song)?;
        for receipt in &self.history {
            replay = replay.accept(&receipt.mutation, receipt.at)?;
            ensure(
                replay.history.last() == Some(receipt),
                "Desktop history does not match its actions",
            )?;
        }
        ensure(
            replay.song == self.song,
            "Desktop history does not match its song",
        )
    }

    pub fn state(&self) -> State {
        State {
            revision: self.revision,
            song: self.song.clone(),
            undoable: self
                .history
                .iter()
                .filter(|r| {
                    !r.deltas.is_empty() && {
                        let mut candidate = self.song.clone();
                        reverse(&mut candidate, &r.deltas).is_ok()
                    }
                })
                .map(|r| r.operation_id.clone())
                .collect(),
        }
    }

    /// A pure SAM acceptance step. The workspace persists the returned candidate
    /// before exposing it. No I/O, task loop or audio callback lives here.
    pub fn accept(&self, m: &Mutation, now: u64) -> Result<Self> {
        m.validate()?;
        ensure(
            m.song_id == self.song.id,
            "Song identity does not match workspace",
        )?;
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
        let proposal = propose(self, &m.action)?;
        proposal.song.validate()?;
        let mut deltas = vec![];
        if self.song.title != proposal.song.title {
            deltas.push(Delta::Title {
                before: self.song.title.clone(),
                after: proposal.song.title.clone(),
            });
        }
        for (id, after) in &proposal.song.tables.events {
            let before = &self.song.tables.events[id];
            if before != after {
                deltas.push(Delta::Event {
                    id: id.clone(),
                    before: Box::new(before.clone()),
                    after: Box::new(after.clone()),
                });
            }
        }
        let mut candidate = self.clone();
        candidate.revision += 1;
        candidate.song = proposal.song;
        candidate.history.push(Receipt {
            operation_id: m.operation_id.clone(),
            mutation: m.clone(),
            revision: candidate.revision,
            deltas,
            at: now,
        });
        Ok(candidate)
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

fn propose(current: &Envelope, action: &Action) -> Result<Proposal> {
    let mut song = current.song.clone();
    match action {
        Action::Rename { title } => song.title = title.clone(),
        Action::MoveNote {
            event_id,
            member_id,
            start,
        } => move_note(&mut song, event_id, member_id.as_deref(), *start)?,
        Action::Undo { target_id } => {
            let receipt = current
                .history
                .iter()
                .find(|r| &r.operation_id == target_id)
                .ok_or_else(|| Error::new("invalid", "Unknown change to undo"))?;
            reverse(&mut song, &receipt.deltas)?;
        }
    }
    Ok(Proposal { song })
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
        }
    }
    Ok(())
}
