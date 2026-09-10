/// D6 performance tripwires, not benchmarks. Budgets sit 30-50x above droplet
/// debug-build measurements (accept ~200ms, reference expand ~600ms, stress
/// expand ~2.7s) to catch hundred-fold regressions on slower CI runners.
/// A budget failure is investigated as a regression, never tuned to fit.
use song_core::{Action, Envelope, Mutation, sounds};
use std::time::Instant;

fn rename(song_id: &str, revision: u64, title: &str) -> Mutation {
    Mutation {
        song_id: song_id.into(),
        expected_revision: revision,
        operation_id: format!("perf-{revision}"),
        label: "perf".into(),
        action: Action::Rename {
            title: title.into(),
        },
    }
}

fn timed(label: &str, f: impl FnOnce()) -> u128 {
    let start = Instant::now();
    f();
    let ms = start.elapsed().as_millis();
    eprintln!("perf {label}: {ms}ms");
    ms
}

#[test]
fn reference_project_accept_and_expand_within_budget() {
    let song = song_testkit::reference_song();
    assert!(song.tables.events.len() >= 10000);
    assert_eq!(song.tables.bars.len(), 1024);
    let id = song.id.clone();
    let mut model = Envelope::fixture(song).unwrap();
    let mut worst = 0;
    for i in 0..5u64 {
        let revision = model.revision;
        let mutation = rename(&id, revision, &format!("Take {i}"));
        let before = Instant::now();
        model = model.accept(&mutation, i + 1).expect("rename must accept");
        worst = worst.max(before.elapsed().as_millis());
    }
    eprintln!("perf reference-accept-worst-of-5: {worst}ms");
    let song = model.song.clone().expect("song present");
    let expand = timed("reference-sounds", || {
        sounds(&song).expect("reference must expand");
    });
    assert!(worst < 10_000, "accept budget");
    assert!(expand < 30_000, "sounds budget");
}

#[test]
fn stress_project_expands_within_budget() {
    let song = song_testkit::stress_song();
    assert!(song.tables.events.len() >= 50_000);
    let expand = timed("stress-sounds", || {
        let expanded = sounds(&song).expect("stress must expand");
        assert!(expanded.len() >= 50_000);
    });
    assert!(expand < 90_000, "stress sounds budget");
}
