use crate::{
    AudioView, OutputDevice,
    schedule::Schedule,
    stream::{Cursor, Metrics},
};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use song_core::{Error, Result, Song};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU32, Ordering},
        mpsc,
    },
    thread,
    time::Duration,
};
use tokio::sync::oneshot;

type Reply<T> = oneshot::Sender<Result<T>>;
enum Work {
    Devices(Reply<Vec<OutputDevice>>),
    View(Reply<AudioView>),
    Play {
        generation: u32,
        song: Box<Song>,
        revision: u64,
        device: Option<String>,
        reply: Reply<()>,
    },
    Stop,
}
/// Device operations never occupy the workspace queue or an async-runtime thread.
/// The stream lives/dies on this worker, including on platforms with thread-bound
/// handles. The callback holds no reference to UI, database or agent objects.
pub struct Engine {
    sender: mpsc::SyncSender<Work>,
    fence: Arc<AtomicU32>,
    closing: Arc<AtomicBool>,
    join: Mutex<Option<thread::JoinHandle<()>>>,
}
impl Engine {
    pub fn new() -> Arc<Self> {
        let (sender, receiver) = mpsc::sync_channel(16);
        let fence = Arc::new(AtomicU32::new(0));
        let closing = Arc::new(AtomicBool::new(false));
        let token = fence.clone();
        let closed = closing.clone();
        let join = thread::spawn(move || worker(receiver, token, closed));
        Arc::new(Self {
            sender,
            fence,
            closing,
            join: Mutex::new(Some(join)),
        })
    }
    /// Reserve before reading the workspace so Stop also fences a pending read.
    pub fn intent(&self) -> Result<u32> {
        if self.closing.load(Ordering::Acquire) {
            return Err(error("Audio is closing"));
        }
        self.fence
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| n.checked_add(1))
            .map(|n| n + 1)
            .map_err(|_| error("Restart the app to reset the audio generation"))
    }
    pub async fn play(
        &self,
        generation: u32,
        song: Song,
        revision: u64,
        device: Option<String>,
    ) -> Result<()> {
        let (reply, receive) = oneshot::channel();
        self.send(Work::Play {
            generation,
            song: Box::new(song),
            revision,
            device,
            reply,
        })?;
        receive.await.map_err(|_| error("Audio worker stopped"))?
    }
    /// Cancel only this pending start; never silence a newer manual playback.
    pub fn cancel_intent(&self, generation: u32) {
        if let Some(next) = generation.checked_add(1) {
            let _ =
                self.fence
                    .compare_exchange(generation, next, Ordering::AcqRel, Ordering::Acquire);
        }
    }
    pub fn stop(&self) -> Result<()> {
        self.intent()?; // immediate silence fence, even when the worker is preparing/opening
        // Timeout polling also observes the fence if the queue is full.
        let _ = self.sender.try_send(Work::Stop);
        Ok(())
    }
    pub async fn view(&self) -> Result<AudioView> {
        let (tx, rx) = oneshot::channel();
        self.send(Work::View(tx))?;
        rx.await.map_err(|_| error("Audio worker stopped"))?
    }
    pub async fn devices(&self) -> Result<Vec<OutputDevice>> {
        let (tx, rx) = oneshot::channel();
        self.send(Work::Devices(tx))?;
        rx.await.map_err(|_| error("Audio worker stopped"))?
    }
    fn send(&self, work: Work) -> Result<()> {
        if self.closing.load(Ordering::Acquire) {
            return Err(error("Audio is closing"));
        }
        self.sender
            .try_send(work)
            .map_err(|_| error("Audio queue is busy; retry"))
    }
    pub fn close(&self) {
        self.closing.store(true, Ordering::Release);
        let _ = self
            .fence
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| n.checked_add(1));
        if let Some(join) = self.join.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = join.join();
        }
    }
}
fn error(message: impl Into<String>) -> Error {
    Error::new("audio", message)
}
struct Playing {
    _stream: cpal::Stream,
    metrics: Arc<Metrics>,
}
fn worker(receiver: mpsc::Receiver<Work>, fence: Arc<AtomicU32>, closing: Arc<AtomicBool>) {
    let mut view = AudioView::default();
    let mut playing: Option<Playing> = None;
    while !closing.load(Ordering::Acquire) {
        update(&mut view, &mut playing, &fence);
        let work = match receiver.recv_timeout(Duration::from_millis(50)) {
            Ok(w) => w,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => break,
        };
        match work {
            Work::Devices(reply) => {
                let result = cpal::default_host()
                    .output_devices()
                    .map_err(|e| error(e.to_string()))
                    .and_then(|devices| {
                        devices
                            .map(|d| {
                                Ok(OutputDevice {
                                    id: d.id().map_err(|e| error(e.to_string()))?.to_string(),
                                    name: d.to_string(),
                                })
                            })
                            .collect()
                    });
                let _ = reply.send(result);
            }
            Work::View(reply) => {
                update(&mut view, &mut playing, &fence);
                let _ = reply.send(Ok(view.clone()));
            }
            Work::Stop => {
                update(&mut view, &mut playing, &fence);
            }
            Work::Play {
                generation,
                song,
                revision,
                device,
                reply,
            } => {
                if generation != fence.load(Ordering::Acquire) {
                    let _ = reply.send(Err(error("Audition superseded or stopped")));
                    continue;
                }
                playing = None; // destroy old stream away from callback
                view = AudioView {
                    generation,
                    revision: Some(revision),
                    ..AudioView::default()
                };
                let result = open(*song, device, generation, fence.clone(), &mut view);
                let result = match result {
                    Ok(p)
                        if generation == fence.load(Ordering::Acquire)
                            && !closing.load(Ordering::Acquire) =>
                    {
                        view.status = "playing".into();
                        playing = Some(p);
                        Ok(())
                    }
                    Ok(_) => Err(error("Audition superseded or stopped")),
                    Err(e) => Err(e),
                };
                if let Err(e) = &result {
                    view.status = "error".into();
                    view.error = Some(e.to_string());
                }
                let _ = reply.send(result);
            }
        }
    }
    drop(playing);
}
fn update(view: &mut AudioView, playing: &mut Option<Playing>, fence: &AtomicU32) {
    if let Some(p) = playing.as_ref() {
        view.frames = p.metrics.frames.load(Ordering::Acquire);
        view.callbacks = p.metrics.callbacks.load(Ordering::Relaxed);
        view.xruns = p.metrics.xruns.load(Ordering::Relaxed);
        view.warning = if view.xruns > 0 {
            Some(format!(
                "Device reported {} buffer underrun/overrun(s); audio may have glitched.",
                view.xruns
            ))
        } else {
            match p.metrics.warning.load(Ordering::Acquire) {
                1 => Some("The system changed the default audio route.".into()),
                2 => Some(
                    "Real-time scheduling was unavailable; audio may glitch under load.".into(),
                ),
                _ => None,
            }
        };
        if p.metrics.failed.load(Ordering::Acquire) {
            view.status = "error".into();
            view.error = Some(format!(
                "Audio device stream failed: {}. Refresh outputs and press Play to retry.",
                p.metrics.detail.read()
            ));
        } else if p.metrics.done.load(Ordering::Acquire) {
            view.status = "ended".into();
        }
    }
    if view.generation != fence.load(Ordering::Acquire) {
        view.generation = fence.load(Ordering::Acquire);
        view.status = "stopped".into();
        view.error = None;
    }
    // Keep the stream emitting silence after end so an already queued final
    // audible buffer drains. Stop/replacement/close releases the device.
    if !["playing", "ended"].contains(&view.status.as_str()) {
        *playing = None;
    }
}
fn open(
    song: Song,
    selected: Option<String>,
    generation: u32,
    fence: Arc<AtomicU32>,
    view: &mut AudioView,
) -> Result<Playing> {
    let host = cpal::default_host();
    let device = if let Some(id) = selected {
        host.output_devices()
            .map_err(|e| error(e.to_string()))?
            .find(|d| d.id().is_ok_and(|v| v.to_string() == id))
            .ok_or_else(|| {
                error("Selected output is unavailable. Refresh outputs and select a device.")
            })?
    } else {
        host.default_output_device()
            .ok_or_else(|| error("No default audio output. Connect a device and retry."))?
    };
    let config = device
        .default_output_config()
        .map_err(|e| error(format!("Cannot open output: {e}")))?;
    let rate = config.sample_rate();
    let channels = config.channels();
    if channels == 0 || channels > 32 {
        return Err(error("Unsupported audio channel count"));
    }
    let pcm =
        Schedule::compile(&song)?.render(rate, || generation != fence.load(Ordering::Acquire))?;
    view.sample_rate = rate;
    view.channels = channels;
    view.device = Some(device.to_string());
    view.total_frames = pcm.len() as u32;
    let metrics = Arc::new(Metrics::default());
    let cursor = Cursor {
        pcm,
        at: 0,
        generation,
        fence,
        metrics: metrics.clone(),
    };
    // Bound requested buffering when the device advertises a range. In
    // particular, sound-server defaults can otherwise queue seconds of audio.
    let format = config.sample_format();
    let buffer_size = match config.buffer_size() {
        cpal::SupportedBufferSize::Range { min, max } => {
            cpal::BufferSize::Fixed(4096.clamp(*min, *max))
        }
        cpal::SupportedBufferSize::Unknown => cpal::BufferSize::Default,
    };
    let stream_config = cpal::StreamConfig {
        buffer_size,
        ..config.into()
    };
    let stream = match format {
        cpal::SampleFormat::F32 => build::<f32>(&device, stream_config, cursor)?,
        cpal::SampleFormat::F64 => build::<f64>(&device, stream_config, cursor)?,
        cpal::SampleFormat::I16 => build::<i16>(&device, stream_config, cursor)?,
        cpal::SampleFormat::U16 => build::<u16>(&device, stream_config, cursor)?,
        cpal::SampleFormat::I32 => build::<i32>(&device, stream_config, cursor)?,
        other => return Err(error(format!("Unsupported audio sample format: {other}"))),
    };
    stream
        .play()
        .map_err(|e| error(format!("Could not start audio: {e}")))?;
    Ok(Playing {
        _stream: stream,
        metrics,
    })
}
fn build<T: cpal::SizedSample + cpal::FromSample<f32>>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    mut cursor: Cursor,
) -> Result<cpal::Stream> {
    let channels = usize::from(config.channels);
    let metrics = cursor.metrics.clone();
    device
        .build_output_stream(
            config,
            move |data: &mut [T], _| cursor.fill(data, channels),
            move |error| metrics.report_error(&error),
            Some(Duration::from_secs(2)),
        )
        .map_err(|e| error(format!("Could not build audio stream: {e}")))
}
