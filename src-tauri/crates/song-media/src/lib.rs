//! D1 media feasibility API. No song mutations, UI, provider or audio monitoring.
pub mod capture;
pub mod decode;
mod ffmpeg;
pub mod store;

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
