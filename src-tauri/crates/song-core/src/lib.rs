//! D1 headless SAM musical slice. No device, UI, database or agent dependencies.
mod actions;
mod arrangement;
mod model;
mod time;
mod timeline;
mod validate;

pub use actions::{Action, Delta, Envelope, Mutation, Receipt, State};
pub use arrangement::{Placement, placements, section_length, section_spans};
pub use model::*;
pub use time::{MAX_SAFE_INTEGER, Time};
pub use timeline::{
    alignment, bars, clicks, cycle_starts, rest_spans, seconds_per_quarter, segments, song_end,
    sounds,
};

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Error {
    pub code: &'static str,
    pub message: String,
}

impl Error {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}
impl std::error::Error for Error {}
pub type Result<T> = std::result::Result<T, Error>;

pub(crate) fn ensure(condition: bool, message: &str) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(Error::new("invalid", message))
    }
}

pub(crate) fn lookup<'a, T>(
    map: &'a std::collections::BTreeMap<String, T>,
    table: &str,
    id: &str,
) -> Result<&'a T> {
    map.get(id)
        .ok_or_else(|| Error::new("invalid", format!("Unknown {table} {id}")))
}
