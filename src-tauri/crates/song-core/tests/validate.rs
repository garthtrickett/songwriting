//! Differential validation against tests/desktop/validate.json. Each case pins
//! the exact TypeScript rejection for one malformed table or lineage fault.
use song_core::Song;

#[test]
fn table_and_lineage_faults_match_typescript_rejections() {
    let cases: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("../../../../tests/desktop/validate.json")).unwrap();
    assert!(!cases.is_empty());
    for case in &cases {
        let name = case["name"].as_str().unwrap();
        let song: Song = serde_json::from_value(case["song"].clone())
            .unwrap_or_else(|e| panic!("{name}: case song must parse: {e}"));
        match song.validate() {
            Ok(()) => assert_eq!(case["ok"], true, "{name}: unexpectedly valid"),
            Err(error) => {
                assert_eq!(case["ok"], false, "{name}: unexpectedly valid");
                assert_eq!(error.message, case["error"], "{name}");
            }
        }
    }
}
