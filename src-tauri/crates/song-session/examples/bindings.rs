use song_session::protocol::{AgentConfig, AgentView, EditRequest, Failure, Snapshot};
use ts_rs::TS;
fn main() {
    let path = std::env::args().nth(1).expect("Output directory required");
    let config = ts_rs::Config::default()
        .with_out_dir(path)
        .with_import_extension(Some("ts"));
    EditRequest::export_all(&config).unwrap();
    Snapshot::export_all(&config).unwrap();
    Failure::export_all(&config).unwrap();
    AgentConfig::export_all(&config).unwrap();
    AgentView::export_all(&config).unwrap();
}
