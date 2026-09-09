//! Bounded native input proof. Call on a dedicated control thread, never an async
//! executor/UI thread. Audio callbacks contain no file/database work or allocation.
use crate::{
    CAPTURE_SECONDS, Result, check_format,
    store::{Capture, Store},
};
use cpal::Sample;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rtrb::{Consumer, Producer, RingBuffer};
use serde::Serialize;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU32, Ordering},
    },
    time::{Duration, Instant},
};

#[derive(Serialize)]
pub struct Input {
    pub id: String,
    pub name: String,
}
pub fn inputs() -> Result<Vec<Input>> {
    cpal::default_host()
        .input_devices()?
        .map(|d| {
            Ok(Input {
                id: d.id()?.to_string(),
                name: d.to_string(),
            })
        })
        .collect()
}
#[derive(Default)]
struct Signals {
    stopped: AtomicBool,
    fault: AtomicU32, // 1: overflow, 2: stream error/xrun, 3: nonfinite input
}
struct Sink {
    producer: Producer<f32>,
    signals: Arc<Signals>,
    remaining: usize,
}
impl Sink {
    fn fill<T: cpal::Sample>(&mut self, data: &[T])
    where
        f32: cpal::FromSample<T>,
    {
        if self.signals.stopped.load(Ordering::Acquire) {
            return;
        }
        for value in data.iter().take(self.remaining) {
            let value = f32::from_sample(*value);
            if !value.is_finite() {
                self.signals.fault.store(3, Ordering::Release);
                self.signals.stopped.store(true, Ordering::Release);
                return;
            }
            if self.producer.push(value).is_err() {
                self.signals.fault.store(1, Ordering::Release);
                self.signals.stopped.store(true, Ordering::Release);
                return;
            }
            self.remaining -= 1;
        }
        if self.remaining == 0 {
            self.signals.stopped.store(true, Ordering::Release);
        }
    }
}
fn stream<T: cpal::SizedSample>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    mut sink: Sink,
) -> Result<cpal::Stream>
where
    f32: cpal::FromSample<T>,
{
    let signals = sink.signals.clone();
    Ok(device.build_input_stream(
        config,
        move |data: &[T], _| sink.fill(data),
        move |_| {
            // Even a recovered xrun makes this capture incomplete; don't hide a gap.
            signals.fault.store(2, Ordering::Release);
            signals.stopped.store(true, Ordering::Release);
        },
        Some(Duration::from_secs(2)),
    )?)
}
fn drain(
    consumer: &mut Consumer<f32>,
    batch: &mut Vec<f32>,
    store: &mut Store,
    id: &str,
    channels: usize,
) -> Result<bool> {
    let mut committed = false;
    while let Ok(sample) = consumer.pop() {
        batch.push(sample);
        if batch.len() == 4096 * channels {
            store.append(id, batch)?;
            batch.clear();
            committed = true;
        }
    }
    Ok(committed)
}

/// Capture under a stable caller-owned ID. Reusing an ID rejects; never restarts
/// a microphone after a lost response. `checkpoint` runs only after durable writes
/// and is used by the proof harness to crash the process at the commit boundary.
pub fn record(
    store: &mut Store,
    id: &str,
    selected: Option<&str>,
    seconds: u32,
    cancel: &AtomicBool,
    mut checkpoint: impl FnMut(),
) -> Result<Capture> {
    if !(1..=CAPTURE_SECONDS).contains(&seconds) {
        return Err("Choose 1–10 seconds for this proof".into());
    }
    if cancel.load(Ordering::Acquire) {
        return Err("Capture cancelled before starting".into());
    }
    let host = cpal::default_host();
    let device = if let Some(id) = selected {
        host.input_devices()?
            .find(|d| d.id().is_ok_and(|v| v.to_string() == id))
            .ok_or("Selected input is unavailable; refresh inputs")?
    } else {
        host.default_input_device()
            .ok_or("No default input; connect a microphone and retry")?
    };
    let config = device.default_input_config()?;
    let rate = config.sample_rate();
    let channels = config.channels();
    check_format(rate, channels as usize)?;
    let format = config.sample_format();
    let config = cpal::StreamConfig {
        buffer_size: match config.buffer_size() {
            cpal::SupportedBufferSize::Range { min, max } => {
                cpal::BufferSize::Fixed(4096.clamp(*min, *max))
            }
            cpal::SupportedBufferSize::Unknown => cpal::BufferSize::Default,
        },
        ..config.into()
    };
    store.begin(id, rate, channels)?;
    let signals = Arc::new(Signals::default());
    // One second of preallocated interleaved input. No unbounded capture queue.
    let (producer, mut consumer) = RingBuffer::new(rate as usize * channels as usize);
    let sink = Sink {
        producer,
        signals: signals.clone(),
        remaining: rate as usize * channels as usize * seconds as usize,
    };
    let result = (|| -> Result<Capture> {
        let stream = match format {
            cpal::SampleFormat::F32 => stream::<f32>(&device, config, sink),
            cpal::SampleFormat::F64 => stream::<f64>(&device, config, sink),
            cpal::SampleFormat::I16 => stream::<i16>(&device, config, sink),
            cpal::SampleFormat::U16 => stream::<u16>(&device, config, sink),
            cpal::SampleFormat::I32 => stream::<i32>(&device, config, sink),
            _ => Err("Unsupported native input sample format".into()),
        }?;
        if cancel.load(Ordering::Acquire) {
            drop(stream);
            return store.interrupt(id, "Capture cancelled while opening the input");
        }
        stream.play()?;
        let deadline = Instant::now() + Duration::from_secs(u64::from(seconds) + 5);
        let mut batch = Vec::with_capacity(4096 * channels as usize);
        while !signals.stopped.load(Ordering::Acquire)
            && !cancel.load(Ordering::Acquire)
            && Instant::now() < deadline
        {
            if drain(&mut consumer, &mut batch, store, id, channels as usize)? {
                checkpoint();
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        signals.stopped.store(true, Ordering::Release);
        drop(stream); // stop and join producer before draining its final samples
        if drain(&mut consumer, &mut batch, store, id, channels as usize)? {
            checkpoint();
        }
        // An overflow may end mid-frame. Retain complete frames; report the gap.
        batch.truncate(batch.len() / channels as usize * channels as usize);
        if !batch.is_empty() {
            store.append(id, &batch)?;
            checkpoint();
        }
        let reason = match signals.fault.load(Ordering::Acquire) {
            1 => "Capture queue overflow; committed prefix retained",
            2 => "Input stream failed or reported an overrun; committed prefix retained",
            3 => "Input supplied non-finite samples; committed prefix retained",
            _ if Instant::now() >= deadline => "Input stalled; committed prefix retained",
            _ if cancel.load(Ordering::Acquire) => "Capture stopped by request",
            _ => "Capture duration reached",
        };
        store.interrupt(id, reason)?;
        if signals.fault.load(Ordering::Acquire) != 0 || Instant::now() >= deadline {
            return store.capture(id);
        }
        store.recover(id)
    })();
    signals.stopped.store(true, Ordering::Release);
    if let Err(error) = &result {
        // On a disk failure even this write may fail. The recording row is then
        // classified as interrupted next time this profile opens.
        let _ = store.interrupt(id, &error.to_string());
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn overflow_fences_callback_and_retains_prefix() {
        let (producer, mut consumer) = RingBuffer::new(2);
        let signals = Arc::new(Signals::default());
        let mut sink = Sink {
            producer,
            signals: signals.clone(),
            remaining: 20,
        };
        sink.fill(&[0.1f32, 0.2, 0.3, 0.4]);
        sink.fill(&[0.5f32]);
        assert_eq!(signals.fault.load(Ordering::Acquire), 1);
        assert!(signals.stopped.load(Ordering::Acquire));
        assert_eq!(consumer.pop().unwrap(), 0.1);
        assert_eq!(consumer.pop().unwrap(), 0.2);
        assert!(consumer.pop().is_err());
    }
    #[test]
    fn duration_cap_and_nonfinite_input() {
        let (producer, mut consumer) = RingBuffer::new(8);
        let signals = Arc::new(Signals::default());
        let mut sink = Sink {
            producer,
            signals: signals.clone(),
            remaining: 2,
        };
        sink.fill(&[0i16, i16::MAX, 42]);
        assert_eq!(consumer.pop().unwrap(), 0.0);
        assert!(consumer.pop().unwrap() > 0.99);
        assert!(consumer.pop().is_err());
        assert_eq!(signals.fault.load(Ordering::Acquire), 0);
        let (producer, _) = RingBuffer::new(8);
        let signals = Arc::new(Signals::default());
        Sink {
            producer,
            signals: signals.clone(),
            remaining: 2,
        }
        .fill(&[f32::NAN]);
        assert_eq!(signals.fault.load(Ordering::Acquire), 3);
    }
}
