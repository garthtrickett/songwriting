use crate::fretted::validate_fretted;
use crate::{Error, Pitch, Result, Song, Time, ensure, lookup, section_length};
use std::collections::BTreeSet;

pub(crate) fn identity(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 100
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        && !["__proto__", "constructor", "prototype"].contains(&id)
}
fn text(s: &str, limit: usize) -> bool {
    s.encode_utf16().count() <= limit
}
fn pitch(p: &Pitch) -> Result<()> {
    ensure(
        (1..=7).contains(&p.degree)
            && (-4..=4).contains(&p.alteration)
            && (-5..=5).contains(&p.octave),
        "Invalid relative pitch",
    )
}
fn positive(t: Time) -> Result<()> {
    ensure(
        t > Time::ZERO,
        "Musical time must be nonnegative (durations positive)",
    )
}
fn nonnegative(t: Time) -> Result<()> {
    ensure(
        t >= Time::ZERO,
        "Musical time must be nonnegative (durations positive)",
    )
}
fn unsupported(condition: bool, feature: &str) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(Error::new(
            "unsupported",
            format!("Outside the D1 fixture cohort: {feature}"),
        ))
    }
}

impl Song {
    pub fn validate(&self) -> Result<()> {
        ensure(self.schema_version == 7, "Unsupported song schema version")?;
        ensure(
            identity(&self.id)
                && text(&self.title, 10000)
                && text(&self.mode, 10000)
                && self.degree_reference == "major",
            "Invalid song identity or tonality",
        )?;
        ensure(
            (10.0..=600.0).contains(&self.tempo.bpm),
            "Tempo must be between 10 and 600 BPM",
        )?;
        positive(self.tempo.beat_unit)?;
        ensure(
            text(&self.writing.instructions, 8000) && text(&self.writing.preferences, 4000),
            "Invalid writing instructions/preferences",
        )?;
        let t = &self.tables;
        ensure(t.prompts.len() <= 32, "At most 32 reusable prompts")?;
        for p in t.prompts.values() {
            ensure(
                text(&p.name, 200) && text(&p.text, 8000),
                "Invalid reusable prompt",
            )?;
        }
        // The remaining binary-coupled tables stay outside the cohort.
        unsupported(t.assets.is_empty(), "assets")?;
        unsupported(t.takes.is_empty(), "takes")?;
        let mut count = 0;
        macro_rules! table {
            ($table:ident) => {
                for (key, entity) in &t.$table {
                    ensure(
                        identity(key) && key == &entity.id && text(&entity.name, 10000),
                        &format!("Invalid identity in {}: {key}", stringify!($table)),
                    )?;
                    count += 1;
                }
            };
        }
        table!(patterns);
        table!(events);
        table!(chords);
        table!(bars);
        table!(sections);
        table!(arrangement);
        table!(parts);
        table!(voices);
        table!(occurrences);
        table!(prompts);
        table!(harmony);
        table!(markers);
        table!(phrases);
        table!(lyrics);
        table!(polyrhythms);
        table!(fretted);
        table!(fingerings);
        ensure(count <= 20000, "Song exceeds 20,000 entities")?;
        for p in t.parts.values() {
            ensure(
                ["guitar", "bass", "drums", "voice"].contains(&p.instrument.as_str())
                    && (0.0..=1.0).contains(&p.volume),
                "Invalid part",
            )?;
        }
        for v in t.voices.values() {
            ensure(
                t.parts.contains_key(&v.part_id),
                &format!("Broken parts reference: {}", v.part_id),
            )?;
        }
        for p in t.patterns.values() {
            positive(p.length)?;
            ensure(p.groups.len() <= 128, "Invalid pattern groups")?;
            let mut total = Time::ZERO;
            for &group in &p.groups {
                positive(group)?;
                total = total.checked_add(group)?;
            }
            ensure(
                p.groups.is_empty() || total == p.length,
                "Pattern groups must sum to cycle length",
            )?;
            ensure(p.length <= Time::new(10000, 1)?, "Pattern too long")?;
            if let Some(id) = &p.source_id {
                ensure(
                    t.patterns.contains_key(id),
                    &format!("Broken patterns reference: {id}"),
                )?;
                ensure(id != &p.id, "Pattern cannot vary itself")?;
            }
        }
        for c in t.chords.values() {
            pitch(&c.label_tonic)?;
            ensure(
                !c.notes.is_empty() && c.notes.len() <= 64,
                "Chord must contain 1–64 notes",
            )?;
            let mut ids = BTreeSet::new();
            for n in &c.notes {
                ensure(
                    identity(&n.id) && ids.insert(&n.id),
                    "Invalid or duplicate chord member",
                )?;
                pitch(&n.pitch)?;
            }
            ensure(
                c.label.as_ref().is_none_or(|s| text(s, 10000)),
                "Invalid chord label",
            )?;
        }
        let mut origins = BTreeSet::new();
        for e in t.events.values() {
            ensure(identity(&e.origin_id), "Invalid event origin")?;
            ensure(
                origins.insert((&e.pattern_id, &e.origin_id)),
                "Event origins must be unique within a pattern",
            )?;
            let p = t.patterns.get(&e.pattern_id).ok_or_else(|| {
                Error::new(
                    "invalid",
                    format!("Broken patterns reference: {}", e.pattern_id),
                )
            })?;
            nonnegative(e.start)?;
            positive(e.duration)?;
            ensure(
                e.start < p.length,
                "Event attack must be inside its pattern",
            )?;
            ensure(
                ["note", "chord", "drum", "rest"].contains(&e.kind.as_str())
                    && ["normal", "staccato", "sustain", "muted", "ghost"]
                        .contains(&e.articulation.as_str()),
                "Invalid event type",
            )?;
            pitch(&e.pitch)?;
            ensure(
                ["kick", "snare", "hat"].contains(&e.drum.as_str())
                    && (0.0..=1.0).contains(&e.accent),
                "Invalid event expression",
            )?;
            let chord = e.chord_id.as_ref().and_then(|id| t.chords.get(id));
            if e.kind == "chord" {
                ensure(chord.is_some(), "Broken chords reference")?;
            } else {
                ensure(e.chord_id.is_none(), "Only chord events reference chords")?;
            }
            ensure(e.performance.len() <= 64, "Invalid chord performance")?;
            ensure(
                e.kind == "chord" || e.performance.is_empty(),
                "Only chords have member performances",
            )?;
            let mut seen = BTreeSet::new();
            for perf in &e.performance {
                ensure(
                    seen.insert(&perf.member_id)
                        && chord.is_some_and(|c| c.notes.iter().any(|n| n.id == perf.member_id)),
                    "Broken/duplicate chord member reference",
                )?;
                if let Some(gain) = perf.gain {
                    ensure((0.0..=1.0).contains(&gain), "Member gain must be 0–1")?;
                }
                if let Some(articulation) = &perf.articulation {
                    ensure(
                        ["inherit", "normal", "staccato", "sustain", "muted", "ghost"]
                            .contains(&articulation.as_str()),
                        "Invalid member articulation",
                    )?;
                }
                nonnegative(perf.offset)?;
                positive(perf.duration)?;
            }
        }
        for b in t.bars.values() {
            ensure(
                t.sections.contains_key(&b.section_id),
                "Broken sections reference",
            )?;
            ensure(
                (1..=64).contains(&b.numerator)
                    && [1, 2, 4, 8, 16, 32, 64].contains(&b.denominator),
                "Invalid time signature",
            )?;
            ensure(
                !b.groups.is_empty()
                    && b.groups.iter().all(|g| (1..=64).contains(g))
                    && b.groups.iter().map(|&g| i64::from(g)).sum::<i64>()
                        == i64::from(b.numerator),
                "Beat groups must sum to numerator",
            )?;
            if let Some(actual) = b.actual {
                positive(actual)?;
                ensure(
                    actual <= Time::new(i64::from(b.numerator) * 4, i64::from(b.denominator))?,
                    "Incomplete bar cannot exceed full bar",
                )?;
            }
        }
        let mut assigned = BTreeSet::new();
        for s in t.sections.values() {
            if let Some(id) = &s.source_id {
                ensure(
                    t.sections.contains_key(id),
                    &format!("Broken sections reference: {id}"),
                )?;
                ensure(id != &s.id, "Section cannot vary itself")?;
            }
            for id in &s.bar_ids {
                ensure(
                    t.bars.get(id).is_some_and(|b| b.section_id == s.id) && assigned.insert(id),
                    "Invalid/duplicate section bar",
                )?;
            }
        }
        ensure(
            assigned.len() == t.bars.len(),
            "Every bar must appear in its section",
        )?;
        for a in t.arrangement.values() {
            ensure(
                t.sections.contains_key(&a.section_id),
                "Broken sections reference",
            )?;
        }
        let order: BTreeSet<_> = self.arrangement_order.iter().collect();
        ensure(
            order.len() == self.arrangement_order.len(),
            "Invalid arrangement order",
        )?;
        ensure(
            order.iter().all(|id| t.arrangement.contains_key(*id)),
            "Broken arrangement reference",
        )?;
        ensure(
            order.len() == t.arrangement.len(),
            "Every section occurrence needs an order",
        )?;
        for o in t.occurrences.values() {
            let p = t
                .patterns
                .get(&o.pattern_id)
                .ok_or_else(|| Error::new("invalid", "Broken patterns reference"))?;
            ensure(
                t.voices.contains_key(&o.voice_id),
                "Broken voices reference",
            )?;
            nonnegative(o.start)?;
            positive(o.span)?;
            nonnegative(o.phase)?;
            if let Some(id) = &o.section_id {
                ensure(
                    t.sections.contains_key(id),
                    &format!("Broken sections reference: {id}"),
                )?;
                let length = section_length(self, id)?;
                ensure(
                    o.start.checked_add(o.span)? <= length,
                    &format!(
                        "Placement {} exceeds its section; adjust its start/span explicitly",
                        o.name
                    ),
                )?;
            }
            ensure(o.phase < p.length, "Phase must be inside pattern")?;
            ensure(
                ["continue", "restart", "stop"].contains(&o.boundary.as_str())
                    && ["ring", "cut"].contains(&o.tails.as_str()),
                "Invalid boundary choice",
            )?;
        }
        for (table, section_id, start, duration, id) in t
            .phrases
            .values()
            .map(|e| ("phrases", &e.section_id, e.start, e.duration, &e.id))
            .chain(
                t.lyrics
                    .values()
                    .map(|e| ("lyrics", &e.section_id, e.start, e.duration, &e.id)),
            )
        {
            ensure(
                t.sections.contains_key(section_id),
                &format!("Broken sections reference: {section_id}"),
            )?;
            nonnegative(start)?;
            positive(duration)?;
            ensure(
                start.checked_add(duration)? <= section_length(self, section_id)?,
                &format!("{table}/{id} exceeds its section"),
            )?;
        }
        for l in t.lyrics.values() {
            ensure(text(&l.text, 10000), "Invalid lyric text")?;
            if let Some(id) = &l.part_id {
                ensure(
                    t.parts.contains_key(id),
                    &format!("Broken parts reference: {id}"),
                )?;
            }
            if let Some(id) = &l.phrase_id {
                let phrase = t.phrases.get(id).ok_or_else(|| {
                    Error::new("invalid", format!("Broken phrases reference: {id}"))
                })?;
                ensure(
                    l.section_id == phrase.section_id
                        && l.start >= phrase.start
                        && l.start.checked_add(l.duration)?
                            <= phrase.start.checked_add(phrase.duration)?,
                    "Linked phrase must contain its lyric span",
                )?;
            }
        }
        for section in t.sections.values() {
            let mut seen = BTreeSet::from([section.id.clone()]);
            let mut parent = section.source_id.clone();
            while let Some(id) = parent {
                ensure(!seen.contains(&id), "Cyclic sections lineage")?;
                seen.insert(id.clone());
                parent = lookup(&t.sections, "section", &id)?.source_id.clone();
            }
        }
        for pattern in t.patterns.values() {
            let mut seen = BTreeSet::from([pattern.id.clone()]);
            let mut parent = pattern.source_id.clone();
            while let Some(id) = parent {
                ensure(!seen.contains(&id), "Cyclic patterns lineage")?;
                seen.insert(id.clone());
                parent = lookup(&t.patterns, "pattern", &id)?.source_id.clone();
            }
        }
        for p in t.polyrhythms.values() {
            nonnegative(p.start)?;
            positive(p.duration)?;
            if let Some(id) = &p.section_id {
                ensure(
                    t.sections.contains_key(id),
                    &format!("Broken sections reference: {id}"),
                )?;
                ensure(
                    p.start.checked_add(p.duration)? <= section_length(self, id)?,
                    "Polyrhythm exceeds its section",
                )?;
            }
            ensure(
                (2..=8).contains(&p.lanes.len()),
                "Polyrhythm needs 2–8 lanes",
            )?;
            let mut voices = BTreeSet::new();
            for lane in &p.lanes {
                let occurrence = t.occurrences.get(&lane.occurrence_id).ok_or_else(|| {
                    Error::new(
                        "invalid",
                        format!("Broken occurrences reference: {}", lane.occurrence_id),
                    )
                })?;
                ensure((1..=64).contains(&lane.divisions), "Divisions must be 1–64")?;
                ensure(
                    occurrence.section_id == p.section_id,
                    "Polyrhythm and placements must share scope",
                )?;
                ensure(
                    voices.insert(&occurrence.voice_id),
                    "Polyrhythm lanes need distinct voices",
                )?;
            }
        }
        let mut regions: Vec<_> = t.harmony.values().collect();
        for h in &regions {
            nonnegative(h.start)?;
            positive(h.duration)?;
            pitch(&h.tonic)?;
            ensure(
                text(&h.mode, 10000) && text(&h.annotation, 10000),
                "Invalid harmonic context text",
            )?;
            if let Some(id) = &h.section_id {
                ensure(
                    t.sections.contains_key(id),
                    &format!("Broken sections reference: {id}"),
                )?;
                ensure(
                    h.start.checked_add(h.duration)? <= section_length(self, id)?,
                    "Harmonic region exceeds section",
                )?;
            }
        }
        regions.sort_by(|a, b| {
            // Matches JSON.stringify(sectionId) ordering: quoted scopes first.
            (a.section_id.is_none(), a.start).cmp(&(b.section_id.is_none(), b.start))
        });
        for pair in regions.windows(2) {
            let (a, b) = (&pair[0], &pair[1]);
            if a.section_id == b.section_id {
                ensure(
                    a.start.checked_add(a.duration)? <= b.start,
                    "Harmonic regions in the same scope cannot overlap",
                )?;
            }
        }
        for m in t.markers.values() {
            nonnegative(m.at)?;
        }
        validate_fretted(self)?;
        Ok(())
    }
}
