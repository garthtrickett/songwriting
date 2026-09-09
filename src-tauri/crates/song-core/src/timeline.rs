//! Timeline expansion: bars, segments, sounding notes, clicks and alignment.
//! Mirrors src/song/timeline.ts against the same validated song shapes.
//! Assumes a validated song; table lookups fail loudly instead of panicking.
use crate::{Placement, Result, Song, Time, ensure, lookup, placements};
use serde::Serialize;
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BarSpan {
    pub id: String,
    pub section_occurrence_id: String,
    pub index: usize,
    pub start: Time,
    pub length: Time,
    pub numerator: i32,
    pub denominator: i32,
    pub groups: Vec<i32>,
}

pub fn bars(song: &Song) -> Result<Vec<BarSpan>> {
    let mut out = Vec::new();
    let mut start = Time::ZERO;
    for aid in &song.arrangement_order {
        let arrangement = lookup(&song.tables.arrangement, "arrangement", aid)?;
        for id in &lookup(&song.tables.sections, "section", &arrangement.section_id)?.bar_ids {
            let bar = lookup(&song.tables.bars, "bar", id)?;
            let length = bar.actual.unwrap_or(Time::new(
                i64::from(bar.numerator) * 4,
                i64::from(bar.denominator),
            )?);
            out.push(BarSpan {
                id: id.clone(),
                section_occurrence_id: aid.clone(),
                index: out.len(),
                start,
                length,
                numerator: bar.numerator,
                denominator: bar.denominator,
                groups: bar.groups.clone(),
            });
            start = start.checked_add(length)?;
        }
    }
    Ok(out)
}

pub fn song_end(song: &Song) -> Result<Time> {
    let mut end = Time::ZERO;
    for bar in bars(song)? {
        let candidate = bar.start.checked_add(bar.length)?;
        if candidate > end {
            end = candidate;
        }
    }
    for placement in placements(song)? {
        let candidate = placement.start.checked_add(placement.span)?;
        if candidate > end {
            end = candidate;
        }
    }
    for region in song.tables.harmony.values() {
        if region.section_id.is_none() {
            let candidate = region.start.checked_add(region.duration)?;
            if candidate > end {
                end = candidate;
            }
        }
    }
    Ok(end)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub start: Time,
    pub end: Time,
    pub phase: Time,
}

pub fn segments(song: &Song, occurrence: &Placement) -> Result<Vec<Segment>> {
    let end = occurrence.start.checked_add(occurrence.span)?;
    let spans = bars(song)?;
    let mut boundaries = Vec::new();
    for (i, bar) in spans.iter().enumerate() {
        if i > 0
            && bar.section_occurrence_id != spans[i - 1].section_occurrence_id
            && bar.start > occurrence.start
            && bar.start < end
        {
            boundaries.push(bar.start);
        }
    }
    if occurrence.boundary == "continue" || boundaries.is_empty() {
        return Ok(vec![Segment {
            start: occurrence.start,
            end,
            phase: occurrence.phase,
        }]);
    }
    if occurrence.boundary == "stop" {
        return Ok(vec![Segment {
            start: occurrence.start,
            end: boundaries[0],
            phase: occurrence.phase,
        }]);
    }
    let mut points = vec![occurrence.start];
    points.extend(boundaries);
    points.push(end);
    let mut out = Vec::new();
    for (i, window) in points.windows(2).enumerate() {
        out.push(Segment {
            start: window[0],
            end: window[1],
            phase: if i == 0 { occurrence.phase } else { Time::ZERO },
        });
    }
    Ok(out)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sound {
    pub appearance_id: Option<String>,
    pub cycle_origin: Time,
    pub member_id: Option<String>,
    pub id: String,
    pub occurrence_id: String,
    pub event_id: String,
    pub voice_id: String,
    pub part_id: String,
    pub start: Time,
    pub duration: Time,
    pub pitch: Option<crate::Pitch>,
    pub drum: String,
    pub gain: f64,
    pub instrument: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestSpan {
    pub event_id: String,
    pub voice_id: String,
    pub start: Time,
    pub duration: Time,
}

fn time_key(t: Time) -> String {
    let (n, d) = t.pair();
    format!("{n}/{d}")
}

pub fn sounds(song: &Song) -> Result<Vec<Sound>> {
    let mut out = Vec::new();
    let mut iterations = 0usize;
    for placement in placements(song)? {
        let pattern = lookup(&song.tables.patterns, "pattern", &placement.pattern_id)?;
        let voice = lookup(&song.tables.voices, "voice", &placement.voice_id)?;
        let part = lookup(&song.tables.parts, "part", &voice.part_id)?;
        if part.muted {
            continue;
        }
        let events: Vec<_> = song
            .tables
            .events
            .values()
            .filter(|e| e.pattern_id == pattern.id)
            .collect();
        for segment in segments(song, &placement)? {
            let mut cycle = segment.start.checked_sub(segment.phase)?;
            while cycle < segment.end {
                iterations += 1;
                ensure(
                    iterations <= 100000,
                    "Timeline is too dense to expand; shorten the selected occurrences",
                )?;
                for event in &events {
                    if event.kind == "rest" {
                        continue;
                    }
                    let attack = cycle.checked_add(event.start)?;
                    let mut notes = Vec::new();
                    if event.kind == "chord" {
                        let chord = lookup(
                            &song.tables.chords,
                            "chord",
                            event.chord_id.as_deref().unwrap_or(""),
                        )?;
                        for note in &chord.notes {
                            notes.push((Some(note.pitch.clone()), note.id.clone()));
                        }
                    } else {
                        let pitch = if event.kind == "drum" {
                            None
                        } else {
                            Some(event.pitch.clone())
                        };
                        notes.push((pitch, String::new()));
                    }
                    for (pitch, member) in notes {
                        let performance = event.performance.iter().find(|p| p.member_id == member);
                        let offset = performance.map_or(Time::ZERO, |p| p.offset);
                        let start = attack.checked_add(offset)?;
                        if start < segment.start || start >= segment.end {
                            continue;
                        }
                        let mut duration = performance.map_or(event.duration, |p| p.duration);
                        let articulation = match performance.and_then(|p| p.articulation.as_deref())
                        {
                            Some(a) if a != "inherit" => a,
                            _ => event.articulation.as_str(),
                        };
                        if articulation == "staccato" {
                            duration = duration.checked_mul(Time::new(1, 2)?)?;
                        }
                        if placement.tails == "cut" && start.checked_add(duration)? > segment.end {
                            duration = segment.end.checked_sub(start)?;
                        }
                        let (n, d) = start.pair();
                        out.push(Sound {
                            id: format!(
                                "{}:{}:{}:{member}:{n},{d}",
                                placement.id,
                                placement.appearance_id.as_deref().unwrap_or("global"),
                                event.id,
                            ),
                            member_id: if member.is_empty() {
                                None
                            } else {
                                Some(member)
                            },
                            occurrence_id: placement.id.clone(),
                            appearance_id: placement.appearance_id.clone(),
                            cycle_origin: start.checked_sub(event.start.checked_add(offset)?)?,
                            event_id: event.id.clone(),
                            voice_id: voice.id.clone(),
                            part_id: part.id.clone(),
                            start,
                            duration,
                            pitch,
                            drum: event.drum.clone(),
                            instrument: part.instrument.clone(),
                            gain: part.volume
                                * event.accent
                                * performance.and_then(|p| p.gain).unwrap_or(1.0)
                                * if articulation == "ghost" { 0.25 } else { 1.0 }
                                * if articulation == "muted" { 0.45 } else { 1.0 },
                        });
                        ensure(out.len() <= 100000, "Too many sounding notes")?;
                    }
                }
                cycle = cycle.checked_add(pattern.length)?;
            }
        }
    }
    let rests = rest_spans(song)?;
    let mut audible = Vec::new();
    for note in &out {
        let mut end = note.start.checked_add(note.duration)?;
        let mut silent = false;
        for rest in &rests {
            if rest.voice_id != note.voice_id {
                continue;
            }
            let rest_end = rest.start.checked_add(rest.duration)?;
            if note.start >= rest.start && note.start < rest_end {
                silent = true;
                break;
            }
            if rest.start > note.start && rest.start < end {
                end = rest.start;
            }
        }
        if !silent {
            let mut trimmed = note.clone();
            trimmed.duration = end.checked_sub(note.start)?;
            audible.push(trimmed);
        }
    }
    audible.sort_by_key(|note| note.start);
    Ok(audible)
}

pub fn alignment(song: &Song, ids: &[String], after: Time, until: Time) -> Result<Option<Time>> {
    ensure(ids.len() >= 2, "Select at least two occurrences")?;
    let all = placements(song)?;
    // Insertion order is ascending time; the first common time in the first
    // occurrence's order wins, so it must not be re-sorted by key spelling.
    let mut ordered: Vec<Vec<(String, Time)>> = Vec::new();
    let mut members: Vec<HashSet<String>> = Vec::new();
    for id in ids {
        let mut times = Vec::new();
        let mut seen = HashSet::new();
        let mut count = 0usize;
        for placement in all.iter().filter(|o| &o.id == id) {
            let pattern = lookup(&song.tables.patterns, "pattern", &placement.pattern_id)?;
            for segment in segments(song, placement)? {
                let mut at = segment.start.checked_sub(segment.phase)?;
                while at < segment.end && at <= until {
                    count += 1;
                    ensure(count <= 100000, "Alignment range too dense")?;
                    if at >= segment.start && at > after {
                        let key = time_key(at);
                        if seen.insert(key.clone()) {
                            times.push((key, at));
                        }
                    }
                    at = at.checked_add(pattern.length)?;
                }
            }
        }
        if times.is_empty() && !song.tables.occurrences.contains_key(id) {
            return Err(crate::Error::new(
                "invalid",
                format!("Unknown occurrence {id}"),
            ));
        }
        members.push(seen);
        ordered.push(times);
    }
    for (key, t) in &ordered[0] {
        if members.iter().all(|set| set.contains(key)) {
            return Ok(Some(*t));
        }
    }
    Ok(None)
}

pub fn seconds_per_quarter(song: &Song) -> f64 {
    60.0 / (song.tempo.bpm * song.tempo.beat_unit.value())
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Click {
    pub at: Time,
    pub strong: bool,
}

pub fn clicks(song: &Song) -> Result<Vec<Click>> {
    let mut out = Vec::new();
    for bar in bars(song)? {
        let mut offset = Time::ZERO;
        for (i, group) in bar.groups.iter().enumerate() {
            out.push(Click {
                at: bar.start.checked_add(offset)?,
                strong: i == 0,
            });
            offset = offset.checked_add(Time::new(
                i64::from(*group) * 4,
                i64::from(bar.denominator),
            )?)?;
        }
    }
    Ok(out)
}

pub fn cycle_starts(song: &Song, occurrence: &Placement) -> Result<Vec<Time>> {
    let mut starts = Vec::new();
    let mut count = 0usize;
    for segment in segments(song, occurrence)? {
        let pattern = lookup(&song.tables.patterns, "pattern", &occurrence.pattern_id)?;
        let mut at = segment.start.checked_sub(segment.phase)?;
        while at < segment.end {
            count += 1;
            ensure(count <= 100000, "Pattern is too dense")?;
            if at >= segment.start {
                starts.push(at);
            }
            at = at.checked_add(pattern.length)?;
        }
    }
    Ok(starts)
}

pub fn rest_spans(song: &Song) -> Result<Vec<RestSpan>> {
    let mut out = Vec::new();
    let mut count = 0usize;
    for placement in placements(song)? {
        let events: Vec<_> = song
            .tables
            .events
            .values()
            .filter(|e| e.pattern_id == placement.pattern_id && e.kind == "rest")
            .collect();
        if events.is_empty() {
            continue;
        }
        for segment in segments(song, &placement)? {
            let pattern = lookup(&song.tables.patterns, "pattern", &placement.pattern_id)?;
            let mut at = segment.start.checked_sub(segment.phase)?;
            while at < segment.end {
                count += 1;
                ensure(count <= 100000, "Rest timeline is too dense")?;
                for event in &events {
                    let start = at.checked_add(event.start)?;
                    if start < segment.start || start >= segment.end {
                        continue;
                    }
                    let end = start.checked_add(event.duration)?;
                    out.push(RestSpan {
                        event_id: event.id.clone(),
                        voice_id: placement.voice_id.clone(),
                        start,
                        duration: if end > segment.end {
                            segment.end.checked_sub(start)?
                        } else {
                            event.duration
                        },
                    });
                }
                at = at.checked_add(pattern.length)?;
            }
        }
    }
    Ok(out)
}
