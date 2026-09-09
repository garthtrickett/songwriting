use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU8, AtomicU32, Ordering},
};

#[derive(Default)]
pub(crate) struct Metrics {
    pub frames: AtomicU32,
    pub callbacks: AtomicU32,
    pub failed: AtomicBool,
    pub done: AtomicBool,
    pub xruns: AtomicU32,
    pub warning: AtomicU32,
    pub detail: ErrorDetail,
}
pub(crate) struct ErrorDetail {
    bytes: [AtomicU8; 192],
    length: AtomicU32,
}
impl Default for ErrorDetail {
    fn default() -> Self {
        Self {
            bytes: std::array::from_fn(|_| AtomicU8::new(0)),
            length: AtomicU32::new(0),
        }
    }
}
impl ErrorDetail {
    fn write(&self, message: &str) {
        let bytes = message.as_bytes();
        let length = bytes.len().min(self.bytes.len());
        for (to, from) in self.bytes.iter().zip(bytes).take(length) {
            to.store(*from, Ordering::Relaxed);
        }
        self.length.store(length as u32, Ordering::Release);
    }
    /// Called only on the control worker, never from an audio callback.
    pub fn read(&self) -> String {
        let bytes: Vec<_> = self
            .bytes
            .iter()
            .take(self.length.load(Ordering::Acquire) as usize)
            .map(|b| b.load(Ordering::Relaxed))
            .collect();
        String::from_utf8_lossy(&bytes).into_owned()
    }
}
impl Metrics {
    pub fn report_error(&self, error: &cpal::Error) {
        if !matches!(
            error.kind(),
            cpal::ErrorKind::Xrun
                | cpal::ErrorKind::DeviceChanged
                | cpal::ErrorKind::RealtimeDenied
        ) && !self.failed.load(Ordering::Acquire)
        {
            self.detail
                .write(error.message().unwrap_or(match error.kind() {
                    cpal::ErrorKind::DeviceBusy => "Device temporarily busy",
                    cpal::ErrorKind::DeviceNotAvailable => "Device unavailable",
                    cpal::ErrorKind::HostUnavailable => "Audio host unavailable",
                    cpal::ErrorKind::PermissionDenied => "Audio permission denied",
                    cpal::ErrorKind::UnsupportedConfig => "Unsupported device configuration",
                    cpal::ErrorKind::UnsupportedOperation => "Unsupported device operation",
                    cpal::ErrorKind::StreamInvalidated => "Stream configuration invalidated",
                    cpal::ErrorKind::ResourceExhausted => "Audio resources exhausted",
                    cpal::ErrorKind::InvalidInput => "Invalid device input",
                    _ => "Unclassified backend failure",
                }));
        }
        self.report(error.kind());
    }
    pub fn report(&self, kind: cpal::ErrorKind) {
        match kind {
            // CPAL recovers xruns and follows supported default-route changes.
            // These must remain visible without turning them into fatal stops.
            cpal::ErrorKind::Xrun => {
                self.xruns.fetch_add(1, Ordering::Relaxed);
            }
            cpal::ErrorKind::DeviceChanged => self.warning.store(1, Ordering::Release),
            cpal::ErrorKind::RealtimeDenied => self.warning.store(2, Ordering::Release),
            _ => self.failed.store(true, Ordering::Release),
        }
    }
}
/// All memory is prepared before starting. An old callback never touches the
/// new stream's counters. The fence is checked each buffer (stop latency is at
/// most an already-submitted device buffer, not a JavaScript timer interval).
pub(crate) struct Cursor {
    pub pcm: Vec<f32>,
    pub at: usize,
    pub generation: u32,
    pub fence: Arc<AtomicU32>,
    pub metrics: Arc<Metrics>,
}
impl Cursor {
    pub fn fill<T: cpal::Sample + cpal::FromSample<f32>>(
        &mut self,
        data: &mut [T],
        channels: usize,
    ) {
        data.fill(T::EQUILIBRIUM);
        if self.fence.load(Ordering::Acquire) != self.generation
            || self.metrics.failed.load(Ordering::Acquire)
        {
            return;
        }
        for frame in data.chunks_exact_mut(channels) {
            if let Some(sample) = self.pcm.get(self.at) {
                frame.fill(T::from_sample(*sample));
                self.at += 1;
            }
        }
        self.metrics.frames.store(self.at as u32, Ordering::Release);
        self.metrics.callbacks.fetch_add(1, Ordering::Relaxed);
        if self.at == self.pcm.len() {
            self.metrics.done.store(true, Ordering::Release);
        }
    }
}
