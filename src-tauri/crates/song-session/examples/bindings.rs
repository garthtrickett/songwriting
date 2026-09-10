use song_session::protocol::{AgentConfig, AgentView, EditRequest, Failure, ProfileView, Snapshot};
use ts_rs::TS;
fn main() {
    let path = std::env::args().nth(1).expect("Output directory required");
    let config = ts_rs::Config::default()
        .with_out_dir(path)
        .with_import_extension(Some("ts"));
    song_audio::AudioView::export_all(&config).unwrap();
    song_audio::AudioPlay::export_all(&config).unwrap();
    song_audio::OutputDevice::export_all(&config).unwrap();
    song_media::MediaView::export_all(&config).unwrap();
    song_media::store::Asset::export_all(&config).unwrap();
    song_media::store::Capture::export_all(&config).unwrap();
    song_media::decode::Summary::export_all(&config).unwrap();
    EditRequest::export_all(&config).unwrap();
    Snapshot::export_all(&config).unwrap();
    Failure::export_all(&config).unwrap();
    AgentConfig::export_all(&config).unwrap();
    AgentView::export_all(&config).unwrap();
    ProfileView::export_all(&config).unwrap();
}
