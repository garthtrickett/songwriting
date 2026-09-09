use crate::{MAX_BYTES, MAX_SECONDS, Result, check_format};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub sample_rate: u32,
    pub channels: usize,
    pub frames: usize,
    pub peak: f32,
    pub rms: f64,
}
pub struct Decoded {
    pub summary: Summary,
    pub samples: Vec<f32>,
}

/// WAV is decoded directly so capture recovery does not require an external
/// decoder. Compressed originals use the explicitly configured FFmpeg worker.
pub fn decode(bytes: &[u8]) -> Result<Decoded> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err("Choose nonempty audio up to 25 MiB".into());
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WAVE") {
        return read_wav(Cursor::new(bytes));
    }
    let output = crate::ffmpeg::decode(bytes)?;
    read_wav(output)
}

fn read_wav(reader: impl std::io::Read) -> Result<Decoded> {
    let mut reader = hound::WavReader::new(reader)?;
    let spec = reader.spec();
    let (rate, channels) = (spec.sample_rate, spec.channels as usize);
    check_format(rate, channels)?;
    if reader.duration() == 0 || reader.duration() > rate * MAX_SECONDS {
        return Err("Decoded audio must be nonempty and at most 60 seconds".into());
    }
    let samples = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .collect::<std::result::Result<Vec<_>, _>>()?,
        hound::SampleFormat::Int => {
            if spec.bits_per_sample == 0 || spec.bits_per_sample > 32 {
                return Err("Unsupported PCM bit depth".into());
            }
            let scale = 2f32.powi(i32::from(spec.bits_per_sample) - 1);
            reader
                .samples::<i32>()
                .map(|s| s.map(|s| s as f32 / scale))
                .collect::<std::result::Result<Vec<_>, _>>()?
        }
    };
    if samples.is_empty()
        || !samples.len().is_multiple_of(channels)
        || !samples.iter().all(|s| s.is_finite())
    {
        return Err("Empty, incomplete or non-finite decoded audio".into());
    }
    let summary = Summary {
        sample_rate: rate,
        channels,
        frames: samples.len() / channels,
        peak: samples.iter().fold(0.0f32, |a, b| a.max(b.abs())),
        rms: (samples.iter().map(|s| f64::from(*s).powi(2)).sum::<f64>() / samples.len() as f64)
            .sqrt(),
    };
    Ok(Decoded { summary, samples })
}

pub fn wav(rate: u32, channels: u16, samples: &[f32]) -> Result<Vec<u8>> {
    check_format(rate, channels as usize)?;
    if samples.is_empty()
        || !samples.len().is_multiple_of(channels as usize)
        || samples.len() > rate as usize * channels as usize * MAX_SECONDS as usize
        || !samples.iter().all(|s| s.is_finite())
    {
        return Err("Invalid PCM samples".into());
    }
    let mut bytes = Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(
            &mut bytes,
            hound::WavSpec {
                channels,
                sample_rate: rate,
                bits_per_sample: 32,
                sample_format: hound::SampleFormat::Float,
            },
        )?;
        for sample in samples {
            writer.write_sample(*sample)?;
        }
        writer.finalize()?;
    }
    Ok(bytes.into_inner())
}
