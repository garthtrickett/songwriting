//! Recorded-take placement expansion. Mirrors takePlacements in media.ts.
//! Content validation of takes stays with the import path; this derives
//! appearance placement for intact records.
use crate::{Result, Song, Time, ensure};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TakePlacement {
    pub id: String,
    pub name: String,
    pub asset_id: String,
    pub part_id: String,
    pub section_id: Option<String>,
    pub start: Time,
    pub offset: f64,
    pub duration: f64,
    pub gain: f64,
    pub muted: bool,
    pub appearance_id: Option<String>,
    pub at: Time,
}

pub fn take_placements(song: &Song) -> Result<Vec<TakePlacement>> {
    let spans = crate::section_spans(song)?;
    let mut out = Vec::new();
    for take in song.tables.takes.values() {
        let base = TakePlacement {
            id: take.id.clone(),
            name: take.name.clone(),
            asset_id: take.asset_id.clone(),
            part_id: take.part_id.clone(),
            section_id: take.section_id.clone(),
            start: take.start,
            offset: take.offset,
            duration: take.duration,
            gain: take.gain,
            muted: take.muted,
            appearance_id: None,
            at: take.start,
        };
        match &take.section_id {
            None => out.push(base),
            Some(section) => {
                for span in spans.iter().filter(|span| &span.section_id == section) {
                    out.push(TakePlacement {
                        appearance_id: Some(span.id.clone()),
                        at: span.start.checked_add(take.start)?,
                        ..base.clone()
                    });
                    ensure(out.len() <= 10000, "Too many take appearances")?;
                }
            }
        }
    }
    ensure(out.len() <= 10000, "Too many take appearances")?;
    out.sort_by_key(|take| take.at);
    Ok(out)
}
