//! Rhythm analysis derivations: alignment maps, polyrhythm grids and pattern
//! comparison. Mirrors rhythm-analysis.ts. Event tiebreaks use ascending
//! (start, id) byte order; the reference uses locale comparison, which agrees
//! on the lowercase fixture ids but can differ for mixed-case ids.
use crate::{Result, Song, Time, ensure, lookup};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

fn time_key(time: Time) -> String {
    let (n, d) = time.pair();
    format!("{n}/{d}")
}

fn unique(mut times: Vec<Time>) -> Vec<Time> {
    times.sort();
    times.dedup();
    times
}

fn check_range(from: Time, until: Time) -> Result<()> {
    ensure(
        from >= Time::ZERO && until >= Time::ZERO,
        "Use normalized nonnegative range times",
    )?;
    ensure(until > from, "Range end must follow start")
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentLane {
    pub id: String,
    pub name: String,
    pub phase: Time,
    pub length: Time,
    pub starts: Vec<Time>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentMap {
    pub from: Time,
    pub until: Time,
    pub lanes: Vec<AlignmentLaneView>,
    pub common: Vec<Time>,
    pub total_common: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentLaneView {
    pub id: String,
    pub name: String,
    pub phase: Time,
    pub length: Time,
    pub total: usize,
    pub starts: Vec<Time>,
}

pub fn alignment_map(song: &Song, ids: &[String], from: Time, until: Time) -> Result<AlignmentMap> {
    check_range(from, until)?;
    ensure(
        ids.len() >= 2 && ids.len() <= 8 && ids.iter().collect::<BTreeSet<_>>().len() == ids.len(),
        "Select 2–8 distinct occurrences",
    )?;
    let resolved = crate::placements(song)?;
    let mut lanes = Vec::new();
    let mut inspected = 0usize;
    for id in ids {
        let occurrence = lookup(&song.tables.occurrences, "occurrence", id)?;
        let mut starts = Vec::new();
        for placement in resolved.iter().filter(|p| &p.id == id) {
            let points = crate::cycle_starts(song, placement)?;
            inspected += points.len();
            ensure(
                inspected <= 100000,
                "Alignment map is too dense; shorten the placements",
            )?;
            starts.extend(points);
        }
        let length = lookup(&song.tables.patterns, "pattern", &occurrence.pattern_id)?.length;
        let starts: Vec<Time> = unique(starts)
            .into_iter()
            .filter(|t| *t >= from && *t <= until)
            .collect();
        lanes.push(AlignmentLane {
            id: id.clone(),
            name: occurrence.name.clone(),
            phase: occurrence.phase,
            length,
            starts,
        });
    }
    let sets: Vec<BTreeSet<String>> = lanes
        .iter()
        .map(|lane| lane.starts.iter().map(|t| time_key(*t)).collect())
        .collect();
    let common: Vec<Time> = lanes[0]
        .starts
        .iter()
        .filter(|t| sets.iter().all(|set| set.contains(&time_key(**t))))
        .cloned()
        .collect();
    let truncated = common.len() > 512 || lanes.iter().any(|lane| lane.starts.len() > 512);
    let total_common = common.len();
    Ok(AlignmentMap {
        from,
        until,
        lanes: lanes
            .into_iter()
            .map(|lane| AlignmentLaneView {
                total: lane.starts.len(),
                starts: lane.starts.into_iter().take(512).collect(),
                id: lane.id,
                name: lane.name,
                phase: lane.phase,
                length: lane.length,
            })
            .collect(),
        common: common.into_iter().take(512).collect(),
        total_common,
        truncated,
    })
}

fn attacks(song: &Song, occurrence: &crate::Placement) -> Result<Vec<Time>> {
    let mut out = Vec::new();
    let events: Vec<_> = song
        .tables
        .events
        .values()
        .filter(|e| e.pattern_id == occurrence.pattern_id && e.kind != "rest")
        .collect();
    let mut count = 0usize;
    for segment in crate::segments(song, occurrence)? {
        let length = lookup(&song.tables.patterns, "pattern", &occurrence.pattern_id)?.length;
        let mut cycle = segment.start.checked_sub(segment.phase)?;
        while cycle < segment.end {
            count += 1;
            ensure(count <= 100000, "Rhythm analysis is too dense")?;
            for event in &events {
                let at = cycle.checked_add(event.start)?;
                if at >= segment.start && at < segment.end {
                    out.push(at);
                }
                ensure(out.len() <= 100000, "Too many attacks to inspect")?;
            }
            cycle = cycle.checked_add(length)?;
        }
    }
    Ok(unique(out))
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GridLane {
    pub occurrence_id: String,
    pub divisions: i32,
    pub expected: Vec<Time>,
    pub actual: Vec<Time>,
    pub total_actual: usize,
    pub truncated: bool,
    pub missing: Vec<Time>,
    pub extra: Vec<Time>,
    pub matches: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GridAppearance {
    pub appearance_id: Option<String>,
    pub start: Time,
    pub duration: Time,
    pub lanes: Vec<GridLane>,
}

pub fn polyrhythm_grid(song: &Song, id: &str) -> Result<Vec<GridAppearance>> {
    let entry = lookup(&song.tables.polyrhythms, "polyrhythm", id)
        .map_err(|_| crate::Error::new("invalid", "Unknown polyrhythm"))?
        .clone();
    let offsets: Vec<(Option<String>, Time)> = match &entry.section_id {
        None => vec![(None, Time::ZERO)],
        Some(section) => crate::section_spans(song)?
            .into_iter()
            .filter(|span| &span.section_id == section)
            .map(|span| (Some(span.id.clone()), span.start))
            .collect(),
    };
    ensure(
        offsets.len() <= 512,
        "Too many polyrhythm appearances; inspect a smaller arrangement",
    )?;
    let resolved = crate::placements(song)?;
    let mut out = Vec::new();
    for (appearance_id, span_start) in offsets {
        let start = span_start.checked_add(entry.start)?;
        let end = start.checked_add(entry.duration)?;
        let mut lanes = Vec::new();
        for lane in &entry.lanes {
            let mut expected = Vec::new();
            for i in 0..lane.divisions {
                expected.push(
                    start.checked_add(
                        entry
                            .duration
                            .checked_mul(Time::new(i64::from(i), i64::from(lane.divisions))?)?,
                    )?,
                );
            }
            let actual: Vec<Time> = unique(
                resolved
                    .iter()
                    .filter(|o| o.id == lane.occurrence_id && o.appearance_id == appearance_id)
                    .map(|o| attacks(song, o))
                    .collect::<Result<Vec<_>>>()?
                    .into_iter()
                    .flatten()
                    .collect(),
            )
            .into_iter()
            .filter(|t| *t >= start && *t < end)
            .collect();
            let expected_set: BTreeSet<String> = expected.iter().map(|t| time_key(*t)).collect();
            let actual_set: BTreeSet<String> = actual.iter().map(|t| time_key(*t)).collect();
            lanes.push(GridLane {
                occurrence_id: lane.occurrence_id.clone(),
                divisions: lane.divisions,
                expected: expected.clone(),
                actual: actual.iter().take(512).cloned().collect(),
                total_actual: actual.len(),
                truncated: actual.len() > 512,
                missing: expected
                    .iter()
                    .filter(|t| !actual_set.contains(&time_key(**t)))
                    .cloned()
                    .collect(),
                extra: actual
                    .iter()
                    .filter(|t| !expected_set.contains(&time_key(**t)))
                    .take(512)
                    .cloned()
                    .collect(),
                matches: actual.len() == expected.len()
                    && expected.iter().all(|t| actual_set.contains(&time_key(*t))),
            });
        }
        out.push(GridAppearance {
            appearance_id,
            start,
            duration: entry.duration,
            lanes,
        });
    }
    Ok(out)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternRow {
    pub origin_id: String,
    pub before: Option<serde_json::Value>,
    pub after: Option<serde_json::Value>,
    pub status: String,
    pub fields: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternComparison {
    pub source: serde_json::Value,
    pub variation: serde_json::Value,
    pub cycle_changed: bool,
    pub groups_changed: bool,
    pub rows: Vec<PatternRow>,
}

pub fn compare_patterns(
    song: &Song,
    source_id: &str,
    variation_id: &str,
) -> Result<PatternComparison> {
    let source = song.tables.patterns.get(source_id);
    let variation = song.tables.patterns.get(variation_id);
    ensure(
        source.is_some() && variation.is_some(),
        "Choose two existing patterns",
    )?;
    let (source, variation) = (source.unwrap(), variation.unwrap());
    let events = |id: &str| {
        let mut list: Vec<_> = song
            .tables
            .events
            .values()
            .filter(|e| e.pattern_id == id)
            .cloned()
            .collect();
        list.sort_by(|a, b| a.start.cmp(&b.start).then(a.id.cmp(&b.id)));
        list
    };
    let left = events(&source.id);
    let right = events(&variation.id);
    let left_map: BTreeMap<&str, &crate::MusicalEvent> =
        left.iter().map(|e| (e.origin_id.as_str(), e)).collect();
    let right_map: BTreeMap<&str, &crate::MusicalEvent> =
        right.iter().map(|e| (e.origin_id.as_str(), e)).collect();
    // Row order follows event order (then right-only additions), not key order.
    let mut origins: Vec<&str> = Vec::new();
    for event in left.iter().chain(right.iter()) {
        if !origins.contains(&event.origin_id.as_str()) {
            origins.push(event.origin_id.as_str());
        }
    }
    let chord_of = |event: &crate::MusicalEvent| -> Result<&crate::Chord> {
        lookup(
            &song.tables.chords,
            "chord",
            event.chord_id.as_deref().unwrap_or(""),
        )
    };
    let content = |event: &crate::MusicalEvent| -> Result<serde_json::Value> {
        if event.kind == "chord" {
            let chord = chord_of(event)?;
            Ok(serde_json::to_value(
                chord
                    .notes
                    .iter()
                    .map(|n| serde_json::json!({"id": n.id, "pitch": n.pitch}))
                    .collect::<Vec<_>>(),
            )
            .unwrap())
        } else if event.kind == "note" {
            Ok(serde_json::to_value(&event.pitch).unwrap())
        } else if event.kind == "drum" {
            Ok(serde_json::Value::String(event.drum.clone()))
        } else {
            Ok(serde_json::Value::Null)
        }
    };
    let label = |event: &crate::MusicalEvent| -> Result<serde_json::Value> {
        if event.kind == "chord" {
            let chord = chord_of(event)?;
            Ok(serde_json::json!([chord.label, chord.label_tonic]))
        } else {
            Ok(serde_json::Value::Null)
        }
    };
    let mut rows = Vec::new();
    for origin_id in origins {
        let before = left_map.get(origin_id).cloned();
        let after = right_map.get(origin_id).cloned();
        let mut fields = Vec::new();
        if let (Some(before), Some(after)) = (before, after) {
            for (name, a, b) in [
                (
                    "kind",
                    serde_json::to_value(&before.kind).unwrap(),
                    serde_json::to_value(&after.kind).unwrap(),
                ),
                (
                    "start",
                    serde_json::to_value(before.start).unwrap(),
                    serde_json::to_value(after.start).unwrap(),
                ),
                (
                    "duration",
                    serde_json::to_value(before.duration).unwrap(),
                    serde_json::to_value(after.duration).unwrap(),
                ),
                (
                    "accent",
                    serde_json::json!(before.accent),
                    serde_json::json!(after.accent),
                ),
                (
                    "articulation",
                    serde_json::to_value(&before.articulation).unwrap(),
                    serde_json::to_value(&after.articulation).unwrap(),
                ),
                (
                    "performance",
                    serde_json::to_value(&before.performance).unwrap(),
                    serde_json::to_value(&after.performance).unwrap(),
                ),
            ] {
                if a != b {
                    fields.push(name.to_string());
                }
            }
            if content(before)? != content(after)? {
                fields.push("notes".to_string());
            }
            if label(before)? != label(after)? {
                fields.push("interpretation".to_string());
            }
        }
        let status = if before.is_none() {
            "added"
        } else if after.is_none() {
            "removed"
        } else if fields.is_empty() {
            "unchanged"
        } else {
            "changed"
        };
        // Re-fetch for ownership; maps hold references into left/right.
        let before = left_map
            .get(origin_id)
            .map(|e| serde_json::to_value(e).unwrap());
        let after = right_map
            .get(origin_id)
            .map(|e| serde_json::to_value(e).unwrap());
        rows.push(PatternRow {
            origin_id: origin_id.to_string(),
            before,
            after,
            status: status.into(),
            fields,
        });
    }
    Ok(PatternComparison {
        source: serde_json::to_value(source.clone()).unwrap(),
        variation: serde_json::to_value(variation.clone()).unwrap(),
        cycle_changed: source.length != variation.length,
        groups_changed: source.groups != variation.groups,
        rows,
    })
}
