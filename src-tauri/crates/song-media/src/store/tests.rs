use super::*;

fn tone(frames: usize) -> Vec<f32> {
    (0..frames)
        .map(|n| (n as f32 * std::f32::consts::TAU * 440.0 / 48000.0).sin() * 0.25)
        .collect()
}
#[test]
fn originals_survive_decode_failure_and_checksum_corruption_is_visible() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let bad = b"not an audio format";
    let asset = store.import(bad).unwrap();
    assert!(asset.error.is_some());
    assert!(asset.audio.is_none());
    assert_eq!(store.original(&asset.id).unwrap(), bad);
    assert_eq!(store.import(bad).unwrap().id, asset.id);
    fs::write(dir.path().join("assets").join(&asset.id), b"corruption").unwrap();
    assert!(store.original(&asset.id).is_err());
    assert!(store.import(bad).is_err());
    assert!(store.original("../media-proof.sqlite").is_err());
}
#[test]
fn interrupted_chunks_recover_exactly_once_without_restarting_capture() {
    let dir = tempfile::tempdir().unwrap();
    let samples = tone(8192);
    {
        let mut store = Store::open(dir.path()).unwrap();
        store.begin("take", 48000, 1).unwrap();
        assert!(store.begin("take", 48000, 1).is_err());
        store.append("take", &samples[..4096]).unwrap();
        store.append("take", &samples[4096..]).unwrap();
        assert!(store.recover("take").is_err());
        assert!(Store::open(dir.path()).is_err()); // live owner cannot be recovered
    }
    let mut store = Store::open(dir.path()).unwrap();
    assert_eq!(store.capture("take").unwrap().status, "interrupted");
    let recovered = store.recover("take").unwrap();
    assert_eq!(recovered.frames, 8192);
    assert_eq!(recovered.status, "ready");
    let asset = recovered.asset_id.unwrap();
    assert_eq!(
        store.recover("take").unwrap().asset_id.as_deref(),
        Some(asset.as_str())
    );
    let decoded = decode::decode(&store.original(&asset).unwrap()).unwrap();
    assert_eq!(decoded.samples, samples);
    assert!(store.append("take", &[0.1]).is_err());
    assert!(store.begin("../bad", 48000, 1).is_err());
}
#[test]
fn disk_full_rolls_back_chunk_and_count_then_recovery_retains_prefix() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    store.begin("take", 48000, 1).unwrap();
    store.append("take", &tone(4096)).unwrap();
    let pages: u32 = store
        .db
        .query_row("PRAGMA page_count", [], |r| r.get(0))
        .unwrap();
    store
        .db
        .pragma_update(None, "max_page_count", pages)
        .unwrap();
    let error = store.append("take", &tone(8192)).unwrap_err();
    assert!(error.to_string().contains("full"), "{error}");
    assert_eq!(store.capture("take").unwrap().frames, 4096);
    drop(store);
    let mut store = Store::open(dir.path()).unwrap();
    assert_eq!(store.recover("take").unwrap().frames, 4096);
}
#[test]
fn pcm_validation_and_failed_asset_write_leave_recoverable_capture() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    store.begin("take", 48000, 2).unwrap();
    assert!(store.append("take", &[0.1]).is_err());
    assert!(store.append("take", &[f32::NAN, 0.0]).is_err());
    store.append("take", &tone(4096)).unwrap();
    store.interrupt("take", "test interruption").unwrap();
    fs::rename(dir.path().join("assets"), dir.path().join("saved-assets")).unwrap();
    fs::write(dir.path().join("assets"), b"blocked directory").unwrap();
    assert!(store.recover("take").is_err());
    assert_eq!(store.capture("take").unwrap().frames, 2048);
    assert_eq!(store.capture("take").unwrap().status, "interrupted");
    fs::remove_file(dir.path().join("assets")).unwrap();
    fs::rename(dir.path().join("saved-assets"), dir.path().join("assets")).unwrap();
    assert_eq!(store.recover("take").unwrap().status, "ready");
}
