//! Procedural instrument voices mirroring instruments.ts: periodic-wave
//! partials for pitched voices, pitch-ramped kicks, seeded noise with
//! highpass filters for snare/hat, and per-kind envelopes. Float bit-parity
//! with Web Audio is not claimed; shapes, determinism and bounds are.
use crate::schedule::{Drum, Instrument, ToneKind};

const GUITAR_PARTIALS: [f64; 6] = [0.0, 1.0, 0.5, 0.28, 0.16, 0.09];
const BASS_PARTIALS: [f64; 4] = [0.0, 1.0, 0.3, 0.12];
const VOICE_PARTIALS: [f64; 5] = [0.0, 1.0, 0.35, 0.2, 0.1];

pub fn partials(instrument: Instrument) -> &'static [f64] {
    match instrument {
        Instrument::Guitar => &GUITAR_PARTIALS,
        Instrument::Bass => &BASS_PARTIALS,
        Instrument::Voice => &VOICE_PARTIALS,
        Instrument::Drums => &[0.0, 1.0],
    }
}

pub fn decay_for(kind: ToneKind) -> f64 {
    match kind {
        ToneKind::Pitched(Instrument::Guitar) => 0.18,
        ToneKind::Drum(Drum::Snare) | ToneKind::Drum(Drum::Hat) => 0.002,
        _ => 0.8,
    }
}

/// Kick pitch in Hz following the reference exponential ramp.
pub fn kick_frequency(t: f64, duration: f64) -> f64 {
    let span = duration.min(0.12);
    if span <= 0.0 {
        return 35.0;
    }
    70.0 * 0.5_f64.powf(t.min(span) / span)
}

pub struct Voice {
    kind: ToneKind,
    phase: f64,
    noise_seed: u32,
    noise_position: usize,
    noise_length: usize,
    filter_x1: f64,
    filter_x2: f64,
    filter_y1: f64,
    filter_y2: f64,
    filter_b0: f64,
    filter_b1: f64,
    filter_b2: f64,
    filter_a1: f64,
    filter_a2: f64,
}

impl Voice {
    pub fn new(kind: ToneKind, rate: u32) -> Self {
        // RBJ highpass at the reference cutoff with unit Q, matching the
        // browser filter topology (exact coefficient parity is not claimed).
        let cutoff = match kind {
            ToneKind::Drum(Drum::Hat) => 6500.0,
            ToneKind::Drum(Drum::Snare) => 900.0,
            _ => 0.0,
        };
        let (b0, b1, b2, a1, a2) = if cutoff > 0.0 {
            let w0 = 2.0 * std::f64::consts::PI * cutoff / f64::from(rate);
            let alpha = w0.sin() / 2.0;
            let cos = w0.cos();
            let norm = 1.0 + alpha;
            (
                (1.0 + cos) / 2.0 / norm,
                -(1.0 + cos) / norm,
                (1.0 + cos) / 2.0 / norm,
                -2.0 * cos / norm,
                (1.0 - alpha) / norm,
            )
        } else {
            (1.0, 0.0, 0.0, 0.0, 0.0)
        };
        Self {
            kind,
            phase: 0.0,
            noise_seed: 123456789,
            noise_position: 0,
            noise_length: (f64::from(rate) * 0.5).ceil().max(1.0) as usize,
            filter_x1: 0.0,
            filter_x2: 0.0,
            filter_y1: 0.0,
            filter_y2: 0.0,
            filter_b0: b0,
            filter_b1: b1,
            filter_b2: b2,
            filter_a1: a1,
            filter_a2: a2,
        }
    }

    fn noise(&mut self) -> f64 {
        if self.noise_position >= self.noise_length {
            self.noise_position = 0;
        }
        self.noise_position += 1;
        self.noise_seed = self
            .noise_seed
            .wrapping_mul(1664525)
            .wrapping_add(1013904223);
        f64::from(self.noise_seed) / 4294967296.0 * 2.0 - 1.0
    }

    fn highpass(&mut self, sample: f64) -> f64 {
        let out = self.filter_b0 * sample
            + self.filter_b1 * self.filter_x1
            + self.filter_b2 * self.filter_x2
            - self.filter_a1 * self.filter_y1
            - self.filter_a2 * self.filter_y2;
        self.filter_x2 = self.filter_x1;
        self.filter_x1 = sample;
        self.filter_y2 = self.filter_y1;
        self.filter_y1 = out;
        out
    }

    /// Raw voice sample before the envelope. Callers advance time; kick
    /// frequency comes from `kick_frequency`.
    pub fn sample(&mut self, frequency: f64, rate: f64) -> f64 {
        match self.kind {
            ToneKind::Drum(Drum::Snare) | ToneKind::Drum(Drum::Hat) => {
                let sample = self.noise();
                self.highpass(sample)
            }
            ToneKind::Drum(Drum::Kick) => {
                self.phase += 2.0 * std::f64::consts::PI * frequency / rate;
                self.phase.sin()
            }
            ToneKind::Pitched(instrument) => {
                self.phase += 2.0 * std::f64::consts::PI * frequency / rate;
                partials(instrument)
                    .iter()
                    .enumerate()
                    .map(|(k, amplitude)| amplitude * (self.phase * k as f64).sin())
                    .sum()
            }
            ToneKind::Click => {
                self.phase += 2.0 * std::f64::consts::PI * frequency / rate;
                self.phase.sin()
            }
        }
    }
}

/// Gain envelope value mirroring the reference ADSR-ish shape.
pub fn envelope_value(gain: f64, duration: f64, t: f64, decay: f64) -> f64 {
    let attack = 0.005_f64.min(duration / 3.0);
    let release = 0.015_f64.min(duration / 3.0);
    if t < attack {
        return gain * t / attack;
    }
    let settle = (duration - release).max(attack);
    let held = if gain > 0.0 {
        let target = (gain * decay).max(0.000001);
        if settle <= attack {
            gain
        } else {
            gain * (target / gain).powf((t.min(settle) - attack) / (settle - attack))
        }
    } else {
        0.0
    };
    if t < settle {
        held
    } else {
        held * (1.0 - (t - settle) / (duration.max(0.005) - settle).max(f64::EPSILON))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pitched_partials_add_energy_over_sine() {
        let rate = 48000.0;
        let mut guitar = Voice::new(ToneKind::Pitched(Instrument::Guitar), 48000);
        let mut sine = Voice::new(ToneKind::Click, 48000);
        let (mut guitar_energy, mut sine_energy) = (0.0, 0.0);
        for _ in 0..4800 {
            guitar_energy += guitar.sample(220.0, rate).powi(2);
            sine_energy += sine.sample(220.0, rate).powi(2);
        }
        assert!(guitar_energy > sine_energy);
    }

    #[test]
    fn noise_hits_are_deterministic_and_highpassed() {
        let mut first = Voice::new(ToneKind::Drum(Drum::Snare), 48000);
        let mut second = Voice::new(ToneKind::Drum(Drum::Snare), 48000);
        for _ in 0..480 {
            assert_eq!(first.sample(0.0, 48000.0), second.sample(0.0, 48000.0));
        }
        let mut hat = Voice::new(ToneKind::Drum(Drum::Hat), 48000);
        let mean: f64 = (0..4800).map(|_| hat.sample(0.0, 48000.0)).sum::<f64>() / 4800.0;
        assert!(mean.abs() < 0.05);
    }

    #[test]
    fn kick_ramps_down_and_holds() {
        assert_eq!(kick_frequency(0.0, 0.2), 70.0);
        assert!((kick_frequency(0.06, 0.2) - 70.0 * 0.5_f64.sqrt()).abs() < 1e-9);
        assert_eq!(kick_frequency(0.12, 0.2), 35.0);
        assert_eq!(kick_frequency(1.0, 0.2), 35.0);
    }

    #[test]
    fn envelope_attacks_peaks_and_releases() {
        assert_eq!(envelope_value(0.5, 1.0, 0.0, 0.18), 0.0);
        let peak = envelope_value(0.5, 1.0, 0.005, 0.18);
        assert!((peak - 0.5).abs() < 1e-12);
        let settled = envelope_value(0.5, 1.0, 0.985, 0.18);
        assert!((settled - 0.5 * 0.18).abs() < 1e-9);
        assert_eq!(envelope_value(0.5, 1.0, 1.0, 0.18), 0.0);
        assert_eq!(envelope_value(0.0, 1.0, 0.5, 0.18), 0.0);
    }
}
