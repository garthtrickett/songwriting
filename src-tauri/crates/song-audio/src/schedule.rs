//! Device-independent audition compiler. Exact music stays exact until sampling.
use song_core::{Error, Occurrence, Pitch, Result, Song, Time};
use std::f64::consts::TAU;

pub const MAX_SECONDS: f64 = 30.0;
const MAX_TONES: usize = 2048;
#[derive(Clone, Debug)]
pub struct Tone {
    pub start: Time,
    pub duration: Time,
    pub frequency: f64,
    pub gain: f64,
    pub metronome: bool,
}
#[derive(Debug)]
pub struct Schedule {
    pub tones: Vec<Tone>,
    pub end: Time,
    seconds_per_quarter: f64,
}
fn number(t: Time) -> f64 {
    let [n, d] = t.into();
    n as f64 / d as f64
}
pub fn frequency(p: &Pitch) -> f64 {
    let semitones = [0, 2, 4, 5, 7, 9, 11][(p.degree - 1) as usize] + p.alteration + p.octave * 12;
    440.0 * 2.0_f64.powf((60 + semitones - 69) as f64 / 12.0)
}
fn limit(message: &str) -> Error {
    Error::new("audio_limit", message)
}
fn unsupported() -> Error {
    Error::new(
        "audio_unsupported",
        "This audition supports normal/sustained pitched events, zero phase and continuing occurrences. Full playback is planned in D3.",
    )
}
impl Schedule {
    pub fn compile(song: &Song) -> Result<Self> {
        song.validate()?;
        let mut out = Self {
            tones: vec![],
            end: Time::ZERO,
            seconds_per_quarter: 60.0 / song.tempo.bpm / number(song.tempo.beat_unit),
        };
        let mut at = Time::ZERO;
        for id in &song.arrangement_order {
            let section = &song.tables.sections[&song.tables.arrangement[id].section_id];
            for o in song
                .tables
                .occurrences
                .values()
                .filter(|o| o.section_id.as_ref() == Some(&section.id))
            {
                out.occurrence(song, o, at)?;
            }
            for id in &section.bar_ids {
                let bar = &song.tables.bars[id];
                let unit = Time::new(4, i64::from(bar.denominator))?;
                let duration = bar
                    .actual
                    .unwrap_or(unit.checked_mul(Time::new(i64::from(bar.numerator), 1)?)?);
                let mut beat = Time::ZERO;
                let mut boundary = 0;
                let mut group = 0;
                for i in 0..bar.numerator {
                    if beat >= duration {
                        break;
                    }
                    let strong = i == boundary;
                    if strong && group < bar.groups.len() {
                        boundary += bar.groups[group];
                        group += 1;
                    }
                    out.push(Tone {
                        start: at.checked_add(beat)?,
                        duration: Time::new(1, 16)?,
                        frequency: if i == 0 {
                            1800.0
                        } else if strong {
                            1400.0
                        } else {
                            1000.0
                        },
                        metronome: true,
                        gain: if strong { 0.12 } else { 0.055 },
                    })?;
                    beat = beat.checked_add(unit)?;
                }
                at = at.checked_add(duration)?;
                out.extend(at)?;
            }
        }
        for o in song
            .tables
            .occurrences
            .values()
            .filter(|o| o.section_id.is_none())
        {
            out.occurrence(song, o, Time::ZERO)?;
        }
        out.tones.sort_by_key(|t| t.start);
        Ok(out)
    }
    fn extend(&mut self, end: Time) -> Result<()> {
        self.end = self.end.max(end);
        if number(self.end) * self.seconds_per_quarter > MAX_SECONDS {
            return Err(limit("Native audition is limited to 30 seconds"));
        }
        Ok(())
    }
    fn push(&mut self, tone: Tone) -> Result<()> {
        if self.tones.len() >= MAX_TONES {
            return Err(limit("Native audition has too many attacks"));
        }
        self.extend(tone.start.checked_add(tone.duration)?)?;
        self.tones.push(tone);
        Ok(())
    }
    fn occurrence(&mut self, song: &Song, o: &Occurrence, section_start: Time) -> Result<()> {
        if o.phase != Time::ZERO || o.boundary != "continue" {
            return Err(unsupported());
        }
        let part = &song.tables.parts[&song.tables.voices[&o.voice_id].part_id];
        let start = section_start.checked_add(o.start)?;
        let end = start.checked_add(o.span)?;
        self.extend(end)?;
        if part.muted {
            return Ok(());
        }
        let pattern = &song.tables.patterns[&o.pattern_id];
        let mut cycle = start;
        let mut cycles = 0;
        while cycle < end {
            cycles += 1;
            if cycles > MAX_TONES {
                return Err(limit("Native audition has too many cycles"));
            }
            for e in song
                .tables
                .events
                .values()
                .filter(|e| e.pattern_id == pattern.id)
            {
                if e.kind == "rest" {
                    continue;
                }
                if e.kind == "drum" || !["normal", "sustain"].contains(&e.articulation.as_str()) {
                    return Err(unsupported());
                }
                let attack = cycle.checked_add(e.start)?;
                if attack >= end {
                    continue;
                }
                let members: Vec<_> = if e.kind == "note" {
                    vec![(&e.pitch, Time::ZERO, e.duration)]
                } else {
                    song.tables.chords[e.chord_id.as_ref().unwrap()]
                        .notes
                        .iter()
                        .map(|n| {
                            let p = e.performance.iter().find(|p| p.member_id == n.id);
                            (
                                &n.pitch,
                                p.map_or(Time::ZERO, |p| p.offset),
                                p.map_or(e.duration, |p| p.duration),
                            )
                        })
                        .collect()
                };
                for (pitch, offset, duration) in members {
                    let start = attack.checked_add(offset)?;
                    // Ringing permits releases beyond the boundary, not new
                    // member attacks outside the occurrence (TypeScript parity).
                    if start >= end {
                        continue;
                    }
                    let release = start.checked_add(duration)?;
                    let release = if o.tails == "cut" {
                        release.min(end)
                    } else {
                        release
                    };
                    if release <= start {
                        continue;
                    }
                    self.push(Tone {
                        start,
                        duration: release.checked_sub(start)?,
                        frequency: frequency(pitch),
                        metronome: false,
                        gain: part.volume * e.accent * 0.10,
                    })?;
                }
            }
            cycle = cycle.checked_add(pattern.length)?;
        }
        Ok(())
    }
    pub fn frame(&self, time: Time, sample_rate: u32) -> usize {
        (number(time) * self.seconds_per_quarter * f64::from(sample_rate)).round() as usize
    }
    /// Prepare bounded mono PCM on the control worker. The device callback only
    /// copies samples, with no oscillators, allocations, queues or locks.
    pub fn render(&self, rate: u32, cancelled: impl Fn() -> bool) -> Result<Vec<f32>> {
        if !(8000..=192000).contains(&rate) {
            return Err(limit("Unsupported audition sample rate"));
        }
        let frames = self.frame(self.end, rate);
        let mut pcm = vec![0.0_f32; frames];
        let mut work = 0;
        for tone in &self.tones {
            let start = self.frame(tone.start, rate);
            let end = self.frame(tone.start.checked_add(tone.duration)?, rate);
            work += end - start;
            if work > rate as usize * 120 {
                return Err(limit("Native audition exceeds its render budget"));
            }
            if tone.frequency >= f64::from(rate) * 0.45 {
                return Err(limit(
                    "A pitch exceeds this device's audition frequency range",
                ));
            }
            let frequency = tone.frequency;
            for (i, sample) in pcm[start..end].iter_mut().enumerate() {
                if i % 4096 == 0 && cancelled() {
                    return Err(Error::new(
                        "audio_cancelled",
                        "Audition superseded or stopped",
                    ));
                }
                let attack = (i as f64 / (f64::from(rate) * 0.005)).min(1.0);
                let release = ((end - start - i) as f64 / (f64::from(rate) * 0.015)).min(1.0);
                *sample += ((TAU * frequency * i as f64 / f64::from(rate)).sin()
                    * tone.gain
                    * attack
                    * release) as f32;
            }
        }
        for sample in &mut pcm {
            *sample = sample.clamp(-0.8, 0.8);
        }
        Ok(pcm)
    }
}
