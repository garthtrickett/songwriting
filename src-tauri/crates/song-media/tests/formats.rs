use sha2::{Digest, Sha256};
use song_media::{decode, store::Store};
use std::path::Path;

#[test]
fn checked_browser_and_supplemental_formats_decode_and_keep_originals() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../tests/desktop/media");
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join("manifest.json")).unwrap()).unwrap();
    let directory = tempfile::tempdir().unwrap();
    let mut store = Store::open(directory.path()).unwrap();
    for fixture in manifest.as_array().unwrap() {
        let name = fixture["file"].as_str().unwrap();
        let bytes = std::fs::read(root.join(name)).unwrap();
        assert_eq!(
            format!("{:x}", Sha256::digest(&bytes)),
            fixture["sha256"].as_str().unwrap(),
            "{name}"
        );
        let decoded = decode::decode(&bytes).unwrap_or_else(|e| panic!("{name}: {e}"));
        let expected = &fixture["expected"];
        assert_eq!(
            decoded.summary.frames,
            expected["frames"].as_u64().unwrap() as usize,
            "{name}"
        );
        assert_eq!(
            decoded.summary.channels,
            expected["channels"].as_u64().unwrap() as usize,
            "{name}"
        );
        assert_eq!(
            decoded.summary.sample_rate,
            expected["sampleRate"].as_u64().unwrap() as u32,
            "{name}"
        );
        assert!(
            (decoded.summary.rms - expected["rms"].as_f64().unwrap()).abs() < 0.005,
            "{name}: signal changed"
        );
        if let Some(browser_seconds) = fixture["decoded"]["duration"].as_f64() {
            let seconds = decoded.summary.frames as f64 / f64::from(decoded.summary.sample_rate);
            assert!(
                (seconds - browser_seconds).abs() < 0.002,
                "{name}: native/browser duration mismatch"
            );
        }
        let asset = store.import(&bytes).unwrap();
        assert!(asset.error.is_none(), "{name}: {:?}", asset.error);
        assert_eq!(store.original(&asset.id).unwrap(), bytes, "{name}");
        println!(
            "{name}: {} frames @ {} Hz, {} channels",
            decoded.summary.frames, decoded.summary.sample_rate, decoded.summary.channels
        );
    }
}

#[test]
fn malformed_and_oversized_pcm_is_rejected_instead_of_truncated() {
    let mut wav = decode::wav(8000, 1, &vec![0.1; 800]).unwrap();
    wav.truncate(wav.len() - 4);
    assert!(decode::decode(&wav).is_err());
    assert!(decode::decode(&[]).is_err());
    assert!(decode::decode(&vec![0; song_media::MAX_BYTES + 1]).is_err());
    assert!(decode::wav(48000, 3, &[0.1, 0.2, 0.3]).is_err());
    assert!(decode::wav(8000, 1, &vec![0.1; 8000 * 61]).is_err());
}
