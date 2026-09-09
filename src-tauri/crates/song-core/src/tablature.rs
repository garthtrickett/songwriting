//! Tablature diagnostics: realised notes with fingerings, technique-source
//! tracing and collision/hand-span checks. Mirrors tablature in tablature.ts.
//! Row order follows timeline expansion; tests canonicalize presentation order.
use crate::{Result, Song, Time, ensure};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabRow {
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
    pub fingering: Option<crate::Fingering>,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaleFingering {
    pub id: String,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tablature {
    pub arrangement: crate::Fretted,
    pub from: Time,
    pub until: Time,
    pub rows: Vec<TabRow>,
    pub total: usize,
    pub truncated: bool,
    pub issue_count: usize,
    pub stale: Vec<StaleFingering>,
    pub unplaced: Vec<String>,
}

fn target_key(
    occurrence: &str,
    event: &str,
    member: Option<&str>,
) -> (String, String, Option<String>) {
    (occurrence.into(), event.into(), member.map(str::to_string))
}

pub fn tablature(song: &Song, arrangement_id: &str, from: Time, until: Time) -> Result<Tablature> {
    let arrangement = song
        .tables
        .fretted
        .get(arrangement_id)
        .ok_or_else(|| crate::Error::new("invalid", "Unknown fretted arrangement"))?
        .clone();
    for at in [from, until] {
        ensure(at >= Time::ZERO, "Use exact nonnegative tab range")?;
    }
    ensure(until > from, "Tab end must follow start")?;
    let fingerings: Vec<_> = song
        .tables
        .fingerings
        .values()
        .filter(|f| f.arrangement_id == arrangement.id)
        .cloned()
        .collect();
    let by_target: BTreeMap<(String, String, Option<String>), &crate::Fingering> = song
        .tables
        .fingerings
        .values()
        .filter(|f| f.arrangement_id == arrangement.id)
        .map(|f| {
            (
                target_key(&f.occurrence_id, &f.event_id, f.member_id.as_deref()),
                f,
            )
        })
        .collect();
    let mut stale = BTreeMap::new();
    for fingering in &fingerings {
        stale.insert(
            fingering.id.clone(),
            crate::fretted::fingering_issues(song, fingering),
        );
    }
    // A muted audition part still has a written arrangement to practise.
    let mut music = song.clone();
    if let Some(part) = music.tables.parts.get_mut(&arrangement.part_id) {
        part.muted = false;
    }
    let mut all = Vec::new();
    for note in crate::sounds(&music)? {
        if note.part_id != arrangement.part_id || note.pitch.is_none() {
            continue;
        }
        let key = target_key(
            &note.occurrence_id,
            &note.event_id,
            note.member_id.as_deref(),
        );
        let fingering = by_target.get(&key).cloned().cloned();
        let issues = match &fingering {
            Some(f) => stale[f.id.as_str()].clone(),
            None => vec!["Unassigned note".into()],
        };
        all.push(TabRow {
            appearance_id: note.appearance_id,
            cycle_origin: note.cycle_origin,
            member_id: note.member_id,
            id: note.id,
            occurrence_id: note.occurrence_id,
            event_id: note.event_id,
            voice_id: note.voice_id,
            part_id: note.part_id,
            start: note.start,
            duration: note.duration,
            pitch: note.pitch,
            drum: note.drum,
            gain: note.gain,
            instrument: note.instrument,
            fingering,
            issues,
        });
    }
    ensure(
        all.len() <= 5000,
        "Tab diagnostics support at most 5,000 realised notes per arrangement",
    )?;
    let mut work = 0usize;
    let mut ends: BTreeMap<String, Time> = BTreeMap::new();
    for row in &all {
        ends.insert(row.id.clone(), row.start.checked_add(row.duration)?);
    }
    // Connected attacks consume the previous string vibration only in this
    // physical view.
    for i in 0..all.len() {
        let (fingering, issues_empty, start) = {
            let row = &all[i];
            (row.fingering.clone(), row.issues.is_empty(), row.start)
        };
        let Some(fingering) = fingering else { continue };
        if !crate::fretted::connected(&fingering) || !issues_empty {
            continue;
        }
        let mut source = None;
        let mut j = i;
        while j > 0 {
            j -= 1;
            work += 1;
            ensure(work <= 2000000, "Tab diagnostic work limit exceeded")?;
            let prev = &all[j];
            if prev.fingering.as_ref().map(|f| f.string) != Some(fingering.string)
                || !(prev.start < start)
            {
                continue;
            }
            if prev.fingering.as_ref().map(|f| &f.id) == fingering.from_id.as_ref()
                && prev.issues.is_empty()
                && ends[prev.id.as_str()] >= start
            {
                source = Some(prev.id.clone());
            }
            break;
        }
        match source {
            Some(id) => {
                ends.insert(id, start);
            }
            None => {
                all[i].issues.push(
                    "Technique source is not the preceding sounding note on this string".into(),
                );
            }
        }
    }
    let mut active: Vec<usize> = Vec::new();
    for i in 0..all.len() {
        let start = all[i].start;
        active.retain(|&p| ends[all[p].id.as_str()] > start);
        if all[i].fingering.is_some() {
            for &p in &active {
                work += 1;
                ensure(work <= 2000000, "Tab diagnostic work limit exceeded")?;
                if all[p].fingering.as_ref().map(|f| f.string)
                    == all[i].fingering.as_ref().map(|f| f.string)
                {
                    let (event, voice) = (all[i].event_id.clone(), all[i].voice_id.clone());
                    let (pevent, pvoice) = (all[p].event_id.clone(), all[p].voice_id.clone());
                    all[i]
                        .issues
                        .push(format!("String collision with {pevent} ({pvoice})"));
                    all[p]
                        .issues
                        .push(format!("String collision with {event} ({voice})"));
                }
            }
            active.push(i);
            let held: Vec<usize> = active
                .iter()
                .cloned()
                .filter(|&p| {
                    all[p]
                        .fingering
                        .as_ref()
                        .is_some_and(|f| f.fret > 0 && f.technique != "tap")
                })
                .collect();
            let frets: Vec<i32> = held
                .iter()
                .map(|&p| all[p].fingering.as_ref().unwrap().fret)
                .collect();
            if !frets.is_empty()
                && frets.iter().max().unwrap() - frets.iter().min().unwrap() > arrangement.hand_span
            {
                for &p in &held {
                    all[p].issues.push("Preferred hand span exceeded".into());
                }
            }
        }
    }
    let selected: Vec<TabRow> = all
        .iter()
        .filter(|n| n.start < until && n.start.checked_add(n.duration).unwrap_or(Time::ZERO) > from)
        .cloned()
        .collect();
    let unplaced: Vec<String> = fingerings
        .iter()
        .filter(|f| {
            !all.iter()
                .any(|n| n.fingering.as_ref().map(|g| &g.id) == Some(&f.id))
        })
        .map(|f| f.id.clone())
        .collect();
    let rows: Vec<TabRow> = selected
        .iter()
        .take(512)
        .map(|n| {
            let mut row = n.clone();
            let mut seen = BTreeSet::new();
            row.issues.retain(|issue| seen.insert(issue.clone()));
            row
        })
        .collect();
    Ok(Tablature {
        arrangement,
        from,
        until,
        total: selected.len(),
        truncated: selected.len() > rows.len(),
        issue_count: selected.iter().filter(|n| !n.issues.is_empty()).count(),
        stale: stale
            .into_iter()
            .filter(|(_, issues)| !issues.is_empty())
            .map(|(id, issues)| StaleFingering { id, issues })
            .collect(),
        unplaced,
        rows,
    })
}
