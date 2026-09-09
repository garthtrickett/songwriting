pub mod schedule;
mod stream;
mod worker;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
pub use worker::Engine;

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct OutputDevice {
    pub id: String,
    pub name: String,
}
#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioView {
    pub generation: u32,
    pub status: String,
    pub device: Option<String>,
    pub sample_rate: u32,
    pub channels: u16,
    pub frames: u32,
    pub total_frames: u32,
    pub callbacks: u32,
    pub xruns: u32,
    pub warning: Option<String>,
    #[ts(type = "number | null")]
    pub revision: Option<u64>,
    pub error: Option<String>,
}
impl Default for AudioView {
    fn default() -> Self {
        Self {
            generation: 0,
            status: "stopped".into(),
            device: None,
            sample_rate: 0,
            channels: 0,
            frames: 0,
            total_frames: 0,
            callbacks: 0,
            xruns: 0,
            warning: None,
            revision: None,
            error: None,
        }
    }
}
#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AudioPlay {
    pub device_id: Option<String>,
}

#[cfg(test)]
mod tests;
