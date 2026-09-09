//! Arrangement expansion: section lengths, spans and occurrence placements.
//! Mirrors src/song/arrangement.ts. Insertion order differs (BTreeMap), so
//! multi-occurrence expansions are canonicalized at comparison time.
use crate::{Occurrence, Result, Song, Time, ensure, lookup};
use serde::Serialize;

pub fn section_length(song: &Song, id: &str) -> Result<Time> {
    let section = lookup(&song.tables.sections, "section", id)?;
    let mut total = Time::ZERO;
    for id in &section.bar_ids {
        let bar = lookup(&song.tables.bars, "bar", id)?;
        total = total.checked_add(bar.actual.unwrap_or(Time::new(
            i64::from(bar.numerator) * 4,
            i64::from(bar.denominator),
        )?))?;
    }
    Ok(total)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionSpan {
    pub id: String,
    pub section_id: String,
    pub start: Time,
    pub length: Time,
}

pub fn section_spans(song: &Song) -> Result<Vec<SectionSpan>> {
    let mut at = Time::ZERO;
    let mut out = Vec::new();
    for id in &song.arrangement_order {
        let span = lookup(&song.tables.arrangement, "arrangement", id)?;
        let length = section_length(song, &span.section_id)?;
        out.push(SectionSpan {
            id: id.clone(),
            section_id: span.section_id.clone(),
            start: at,
            length,
        });
        at = at.checked_add(length)?;
    }
    Ok(out)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub table: String,
    pub id: String,
    pub name: String,
    pub start: Time,
    pub duration: Time,
    pub appearance_id: String,
}

pub fn annotations(song: &Song) -> Result<Vec<Annotation>> {
    let mut out = Vec::new();
    let mut push = |annotation: Annotation| -> Result<()> {
        out.push(annotation);
        ensure(out.len() <= 100000, "Too many arranged annotations")
    };
    for span in section_spans(song)? {
        for phrase in song
            .tables
            .phrases
            .values()
            .filter(|p| p.section_id == span.section_id)
        {
            push(Annotation {
                table: "phrases".into(),
                id: phrase.id.clone(),
                name: phrase.name.clone(),
                start: span.start.checked_add(phrase.start)?,
                duration: phrase.duration,
                appearance_id: span.id.clone(),
            })?;
        }
        for lyric in song
            .tables
            .lyrics
            .values()
            .filter(|l| l.section_id == span.section_id)
        {
            push(Annotation {
                table: "lyrics".into(),
                id: lyric.id.clone(),
                name: lyric.name.clone(),
                start: span.start.checked_add(lyric.start)?,
                duration: lyric.duration,
                appearance_id: span.id.clone(),
            })?;
        }
    }
    Ok(out)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub id: String,
    pub name: String,
    pub section_id: Option<String>,
    pub pattern_id: String,
    pub voice_id: String,
    pub start: Time,
    pub span: Time,
    pub phase: Time,
    pub boundary: String,
    pub tails: String,
    pub appearance_id: Option<String>,
}

impl Placement {
    fn of(occurrence: &Occurrence, start: Time, appearance_id: Option<String>) -> Self {
        Self {
            id: occurrence.id.clone(),
            name: occurrence.name.clone(),
            section_id: occurrence.section_id.clone(),
            pattern_id: occurrence.pattern_id.clone(),
            voice_id: occurrence.voice_id.clone(),
            start,
            span: occurrence.span,
            phase: occurrence.phase,
            boundary: occurrence.boundary.clone(),
            tails: occurrence.tails.clone(),
            appearance_id,
        }
    }
}

pub fn placements(song: &Song) -> Result<Vec<Placement>> {
    let spans = section_spans(song)?;
    let mut out = Vec::new();
    for occurrence in song.tables.occurrences.values() {
        match &occurrence.section_id {
            None => out.push(Placement::of(occurrence, occurrence.start, None)),
            Some(section) => {
                for span in spans.iter().filter(|span| &span.section_id == section) {
                    out.push(Placement::of(
                        occurrence,
                        span.start.checked_add(occurrence.start)?,
                        Some(span.id.clone()),
                    ));
                    ensure(out.len() <= 100000, "Too many arranged placements")?;
                }
            }
        }
    }
    Ok(out)
}
