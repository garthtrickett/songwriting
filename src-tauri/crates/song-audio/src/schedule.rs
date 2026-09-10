//! Device-independent audition compiler over the canonical timeline
//! expansion. Exact music stays exact until sampling; only metronome click
//! durations are microsecond-approximated (a 60 ms blip, sub-frame at every
//! supported rate).
use song_core::{Error, Result, Song, Time, semitone};

pub const MAX_SECONDS: f64 = 600.0;
const MAX_TONES: usize = 65536;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Instrument {
    Guitar,
    Bass,
    Drums,
    Voice,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Drum {
    Kick,
    Snare,
    Hat,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToneKind {
    Pitched(Instrument),
    Drum(Drum),
    Click,
}

#[derive(Clone, Debug)]
pub struct Tone {
    pub start: Time,
    pub duration: Time,
    pub frequency: f64,
    pub gain: f64,
    pub kind: ToneKind,
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

/// Equal-tempered frequency for a relative pitch at a playback key (MIDI).
pub fn frequency(pitch: &song_core::Pitch, tonic: i32) -> f64 {
    440.0 * 2.0_f64.powf(f64::from(tonic + semitone(pitch) - 69) / 12.0)
}

fn limit(message: &str) -> Error {
    Error::new("audio_limit", message)
}

fn instrument(name: &str) -> Instrument {
    match name {
        "guitar" => Instrument::Guitar,
        "bass" => Instrument::Bass,
        "voice" => Instrument::Voice,
        _ => Instrument::Drums,
    }
}

fn drum(name: &str) -> Drum {
    match name {
        "snare" => Drum::Snare,
        "hat" => Drum::Hat,
        _ => Drum::Kick,
    }
}

pub struct Compile {
    pub tonic: i32,
    pub metronome: bool,
    pub from: Time,
}

impl Schedule {
    pub fn compile(song: &Song, options: &Compile) -> Result<Self> {
        song.validate()?;
        let seconds_per_quarter = 60.0 / song.tempo.bpm / number(song.tempo.beat_unit);
        let mut out = Self {
            tones: vec![],
            end: Time::ZERO,
            seconds_per_quarter,
        };
        for note in song_core::sounds(song)? {
            let close = note.start.checked_add(note.duration)?;
            if close <= options.from {
                continue;
            }
            let start = if note.start < options.from {
                options.from
            } else {
                note.start
            };
            let (frequency, kind) = match &note.pitch {
                Some(pitch) => (
                    frequency(pitch, options.tonic),
                    ToneKind::Pitched(instrument(note.instrument.as_str())),
                ),
                None => (
                    match drum(note.drum.as_str()) {
                        Drum::Kick => 70.0,
                        Drum::Snare => 180.0,
                        Drum::Hat => 7000.0,
                    },
                    ToneKind::Drum(drum(note.drum.as_str())),
                ),
            };
            out.push(Tone {
                start,
                duration: close.checked_sub(start)?,
                frequency,
                gain: note.gain * 0.2,
                kind,
                metronome: false,
            })?;
        }
        if options.metronome {
            for click in song_core::clicks(song)? {
                if click.at < options.from {
                    continue;
                }
                // A 60 ms blip in quarters; microsecond-exact, sub-frame.
                let micros = (0.06 / seconds_per_quarter * 1_000_000.0).round() as i64;
                out.push(Tone {
                    start: click.at,
                    duration: Time::new(micros.max(1), 1_000_000)?,
                    frequency: if click.strong { 1500.0 } else { 950.0 },
                    gain: if click.strong { 0.18 } else { 0.1 },
                    kind: ToneKind::Click,
                    metronome: true,
                })?;
            }
        }
        out.tones.sort_by_key(|tone| tone.start);
        out.end = song_core::song_end(song)?;
        for tone in &out.tones {
            out.end = out.end.max(tone.start.checked_add(tone.duration)?);
        }
        if number(out.end) * seconds_per_quarter > MAX_SECONDS {
            return Err(limit("Native audition is limited to 600 seconds"));
        }
        Ok(out)
    }
    fn extend(&mut self, end: Time) -> Result<()> {
        self.end = self.end.max(end);
        if number(self.end) * self.seconds_per_quarter > MAX_SECONDS {
            return Err(limit("Native audition is limited to 600 seconds"));
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
    pub fn frame(&self, time: Time, sample_rate: u32) -> usize {
        (number(time) * self.seconds_per_quarter * f64::from(sample_rate)).round() as usize
    }
    /// Prepare bounded mono PCM on the control worker. The device callback only
    /// copies samples, with no oscillators, allocations, queues or locks.
    pub fn render(&self, rate: u32, cancelled: impl Fn() -> bool) -> Result<Vec<f32>> {
        use crate::instruments::{Voice, decay_for, envelope_value, kick_frequency};
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
            let duration = number(tone.duration) * self.seconds_per_quarter;
            let decay = decay_for(tone.kind);
            let mut voice = Voice::new(tone.kind, rate);
            for (i, sample) in pcm[start..end].iter_mut().enumerate() {
                if i % 4096 == 0 && cancelled() {
                    return Err(Error::new(
                        "audio_cancelled",
                        "Audition superseded or stopped",
                    ));
                }
                let t = i as f64 / f64::from(rate);
                let frequency = match tone.kind {
                    crate::schedule::ToneKind::Drum(crate::schedule::Drum::Kick) => {
                        kick_frequency(t, duration)
                    }
                    _ => tone.frequency,
                };
                *sample += (voice.sample(frequency, f64::from(rate))
                    * envelope_value(tone.gain, duration, t, decay))
                    as f32;
            }
        }
        for sample in &mut pcm {
            *sample = sample.clamp(-0.8, 0.8);
        }
        Ok(pcm)
    }
}
