//! D1 media feasibility API. No song mutations, UI, provider or audio monitoring.
pub mod capture;
pub mod decode;
mod ffmpeg;
pub mod store;

use serde::Serialize;
use ts_rs::TS;

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
pub const MAX_BYTES: usize = 25 * 1024 * 1024;
pub const MAX_SECONDS: u32 = 60;
pub const CAPTURE_SECONDS: u32 = 10;

pub fn check_format(rate: u32, channels: usize) -> Result<()> {
    if !(8000..=192000).contains(&rate) || !(1..=2).contains(&channels) {
        return Err("Proof supports 8–192 kHz mono/stereo audio".into());
    }
    Ok(())
}

/// Configured compressed-audio decoder without probing execution. An explicit
/// `SONGWRITER_FFMPEG` path wins (proof harness, developer override), then a
/// staged sidecar beside the application executable, then `ffmpeg` on PATH.
pub fn decoder() -> String {
    resolve_decoder(
        &std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
            .unwrap_or_default(),
        std::env::var_os("SONGWRITER_FFMPEG").as_deref(),
    )
}

pub(crate) fn sidecar_name() -> &'static str {
    if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    }
}

/// Pure resolution order for tests: explicit override, staged sidecar, PATH.
fn resolve_decoder(exe_dir: &std::path::Path, env_override: Option<&std::ffi::OsStr>) -> String {
    if let Some(explicit) = env_override {
        return explicit.to_string_lossy().into_owned();
    }
    let staged = exe_dir.join(sidecar_name());
    if staged.is_file() {
        return staged.to_string_lossy().into_owned();
    }
    "ffmpeg".into()
}

/// Read-only desktop status over a media profile. D1 surfaces visibility only;
/// recording, import and take attachment remain D4 work.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MediaView {
    pub available: bool,
    pub decoder: String,
    pub assets: Vec<store::Asset>,
    pub captures: Vec<store::Capture>,
    pub error: Option<String>,
}

impl MediaView {
    pub fn unavailable(error: String) -> Self {
        Self {
            available: false,
            decoder: decoder(),
            assets: Vec::new(),
            captures: Vec::new(),
            error: Some(error),
        }
    }
}

/// Open a profile and report its preserved originals and capture states.
/// Never records, imports or mutates song state; opening marks any stale
/// `recording` row interrupted, which is the designed crash visibility.
pub fn status(root: &std::path::Path) -> MediaView {
    match store::Store::open_named(root, "media") {
        Ok(store) => match store
            .assets()
            .and_then(|assets| store.captures().map(|captures| (assets, captures)))
        {
            Ok((assets, captures)) => MediaView {
                available: true,
                decoder: decoder(),
                assets,
                captures,
                error: None,
            },
            Err(error) => MediaView::unavailable(error.to_string()),
        },
        Err(error) => MediaView::unavailable(error.to_string()),
    }
}
