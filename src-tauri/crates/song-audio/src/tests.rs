use crate::{
    Engine,
    schedule::{Compile, Schedule, frequency},
    stream::{Cursor, Metrics},
};
use song_core::{Pitch, Song, Time};
use std::sync::{
    Arc,
    atomic::{AtomicU32, Ordering},
};
fn fixture() -> Song {
    serde_json::from_str(include_str!("../../../../tests/desktop/fixture.json")).unwrap()
}
fn t(n: i64, d: i64) -> Time {
    Time::new(n, d).unwrap()
}
fn opts() -> Compile {
    Compile {
        tonic: 48,
        metronome: true,
        from: Time::ZERO,
    }
}
fn cursor(pcm: Vec<f32>, fence: Arc<AtomicU32>, generation: u32) -> Cursor {
    Cursor {
        pcm,
        at: 0,
        generation,
        fence,
        metrics: Arc::new(Metrics::default()),
    }
}
#[test]
fn exact_mixed_meter_clicks_and_relative_chord_members() {
    let mut song = fixture();
    song.tables
        .events
        .get_mut("harmony")
        .unwrap()
        .performance
        .push(song_core::Performance {
            member_id: "root".into(),
            offset: t(1, 3),
            duration: t(2, 1),
            gain: None,
            articulation: None,
        });
    let schedule = Schedule::compile(&song, &opts()).unwrap();
    assert_eq!(schedule.frame(t(7, 2), 48000), 90000);
    let clicks: Vec<_> = schedule.tones.iter().filter(|t| t.metronome).collect();
    assert_eq!(clicks.len(), 5); // groups 2+2+3 then 3+2
    assert_eq!(clicks[0].frequency, 1500.0);
    assert_eq!(clicks[1].frequency, 950.0);
    assert_eq!(clicks[0].start, t(0, 1));
    assert_eq!(clicks[3].start, t(7, 2));
    assert!(clicks.iter().all(|c| c.gain
        == if c.start == t(0, 1) || c.start == t(7, 2) {
            0.18
        } else {
            0.1
        }));
    let root = frequency(
        &Pitch {
            degree: 1,
            alteration: 0,
            octave: 0,
        },
        48,
    );
    assert!(schedule.tones.iter().any(|n| !n.metronome
        && n.start == t(4, 3)
        && n.duration == t(2, 1)
        && n.frequency == root));
    assert!(
        (frequency(
            &Pitch {
                degree: 6,
                alteration: 0,
                octave: 0
            },
            60
        ) - 440.0)
            .abs()
            < 1e-8
    );
    assert!(
        (frequency(
            &Pitch {
                degree: 7,
                alteration: -1,
                octave: 0
            },
            48
        ) / root
            - 2.0_f64.powf(10.0 / 12.0))
        .abs()
            < 1e-8
    );
}
#[test]
fn prepared_audio_is_buffer_invariant_and_naturally_silent() {
    let pcm = Schedule::compile(&fixture(), &opts())
        .unwrap()
        .render(48000, || false)
        .unwrap();
    assert!(pcm.iter().any(|s| s.abs() > 0.05));
    assert!(pcm.iter().all(|s| s.is_finite() && s.abs() <= 0.8));
    let fence = Arc::new(AtomicU32::new(1));
    let mut a = cursor(pcm.clone(), fence.clone(), 1);
    let mut b = cursor(pcm.clone(), fence, 1);
    let mut full = vec![0.0; pcm.len() * 2 + 32];
    a.fill(&mut full, 2);
    let mut chunks = vec![];
    for size in [126, 510, 2048].into_iter().cycle() {
        let count = size.min(full.len() - chunks.len());
        if count == 0 {
            break;
        }
        let mut block = vec![0.0; count];
        b.fill(&mut block, 2);
        chunks.extend(block);
    }
    assert_eq!(full, chunks);
    assert_eq!(a.metrics.frames.load(Ordering::Acquire) as usize, pcm.len());
    assert!(a.metrics.done.load(Ordering::Acquire));
    assert!(full[pcm.len() * 2..].iter().all(|s| *s == 0.0));
}
#[test]
fn stop_replacement_and_device_error_silence_obsolete_callbacks() {
    let fence = Arc::new(AtomicU32::new(1));
    let mut old = cursor(vec![0.5; 64], fence.clone(), 1);
    let mut block = [0.0; 16];
    old.fill(&mut block, 2);
    assert_eq!(block, [0.5; 16]);
    fence.store(2, Ordering::Release);
    old.fill(&mut block, 2);
    assert_eq!(block, [0.0; 16]);
    let mut new = cursor(vec![0.25; 64], fence.clone(), 2);
    new.fill(&mut block, 2);
    assert_eq!(block, [0.25; 16]);
    old.fill(&mut block, 2);
    assert_eq!(new.metrics.frames.load(Ordering::Acquire), 8);
    new.metrics.failed.store(true, Ordering::Release);
    let mut integers = [0_u16; 16];
    new.fill(&mut integers, 2);
    assert_eq!(integers, [32768; 16]);
}
#[test]
fn preparation_limits_cancellation_and_long_songs_are_explicit() {
    let mut song = fixture();
    assert_eq!(
        Schedule::compile(&song, &opts())
            .unwrap()
            .render(48000, || true)
            .unwrap_err()
            .code,
        "audio_cancelled"
    );
    // A thousand-verse arrangement runs past the documented 600-second bound.
    for i in 0..1000 {
        let id = format!("again{i}");
        song.tables.arrangement.insert(
            id.clone(),
            song_core::Arrangement {
                id: id.clone(),
                name: "Again".into(),
                section_id: "verse".into(),
            },
        );
        song.arrangement_order.push(id);
    }
    song.validate().unwrap();
    assert_eq!(
        Schedule::compile(&song, &opts()).unwrap_err().code,
        "audio_limit"
    );
}
#[test]
fn phases_drums_and_articulations_play_instead_of_failing() {
    let mut song = fixture();
    song.tables.occurrences.get_mut("lead1").unwrap().phase = t(1, 3);
    song.tables.events.insert(
        "drum1".into(),
        song_core::MusicalEvent {
            id: "drum1".into(),
            name: "Kick".into(),
            origin_id: "drum1".into(),
            pattern_id: "riff".into(),
            kind: "drum".into(),
            start: t(0, 1),
            duration: t(1, 4),
            pitch: Pitch {
                degree: 1,
                alteration: 0,
                octave: 0,
            },
            chord_id: None,
            drum: "kick".into(),
            accent: 0.9,
            articulation: "normal".into(),
            performance: vec![],
        },
    );
    song.tables.events.get_mut("note").unwrap().articulation = "staccato".into();
    song.validate().unwrap();
    let schedule = Schedule::compile(&song, &opts()).unwrap();
    assert!(
        schedule
            .tones
            .iter()
            .any(|tone| !tone.metronome && tone.frequency == 70.0)
    );
    assert!(schedule.tones.iter().any(|tone| {
        !tone.metronome
            && tone.duration == t(1, 3)
            && (tone.frequency
                - frequency(
                    &Pitch {
                        degree: 7,
                        alteration: -1,
                        octave: 1,
                    },
                    48,
                ))
            .abs()
                < 1e-8
    }));
}
#[test]
fn seek_starts_mid_song_with_trimmed_attacks() {
    let song = fixture();
    let schedule = Schedule::compile(
        &song,
        &Compile {
            from: t(1, 2),
            ..opts()
        },
    )
    .unwrap();
    assert!(
        schedule
            .tones
            .iter()
            .all(|tone| tone.start.checked_add(tone.duration).unwrap() > t(1, 2))
    );
    assert!(
        schedule
            .tones
            .iter()
            .any(|tone| !tone.metronome && tone.start == t(1, 2) && tone.duration == t(1, 2))
    );
    assert!(
        schedule
            .tones
            .iter()
            .any(|tone| tone.metronome && tone.start >= t(1, 2))
    );
}
#[tokio::test]
async fn pending_starts_are_fenced_and_missing_selection_never_falls_back() {
    let engine = Engine::new();
    let pending = engine.intent().unwrap();
    engine.stop().unwrap();
    assert!(
        engine
            .play(
                pending,
                fixture(),
                0,
                crate::AudioPlay {
                    device_id: None,
                    tonic: None,
                    metronome: None,
                    from: None,
                }
            )
            .await
            .unwrap_err()
            .message
            .contains("superseded")
    );
    assert_eq!(engine.view().await.unwrap().status, "stopped");
    let current = engine.intent().unwrap();
    engine.cancel_intent(pending); // must not cancel a newer manual start
    assert!(
        engine
            .play(
                current,
                fixture(),
                7,
                crate::AudioPlay {
                    device_id: Some("songwriter-missing-output".into()),
                    tonic: None,
                    metronome: None,
                    from: None,
                }
            )
            .await
            .unwrap_err()
            .message
            .contains("unavailable")
    );
    let view = engine.view().await.unwrap();
    assert_eq!(view.status, "error");
    assert_eq!(view.revision, Some(7));
    engine.stop().unwrap();
    assert_eq!(engine.view().await.unwrap().status, "stopped");
    engine.close();
    assert!(engine.intent().is_err());
}

#[test]
fn pitched_schedules_match_existing_typescript_timeline() {
    #[derive(serde::Deserialize)]
    struct Expected {
        start: Time,
        duration: Time,
        frequency: f64,
        gain: f64,
    }
    #[derive(serde::Deserialize)]
    struct Case {
        name: String,
        song: Song,
        notes: Vec<Expected>,
    }
    let cases: Vec<Case> =
        serde_json::from_str(include_str!("../../../../tests/desktop/audio.json")).unwrap();
    for mut case in cases {
        let schedule = Schedule::compile(
            &case.song,
            &Compile {
                tonic: 48,
                metronome: false,
                from: Time::ZERO,
            },
        )
        .unwrap();
        let mut actual: Vec<_> = schedule
            .tones
            .into_iter()
            .filter(|n| !n.metronome)
            .collect();
        actual.sort_by(|a, b| {
            a.start
                .cmp(&b.start)
                .then(a.frequency.total_cmp(&b.frequency))
        });
        case.notes.sort_by(|a, b| {
            a.start
                .cmp(&b.start)
                .then(a.frequency.total_cmp(&b.frequency))
        });
        assert_eq!(actual.len(), case.notes.len(), "{}", case.name);
        for (a, b) in actual.iter().zip(&case.notes) {
            assert_eq!(
                (a.start, a.duration),
                (b.start, b.duration),
                "{}",
                case.name
            );
            assert!((a.frequency - b.frequency).abs() < 1e-8, "{}", case.name);
            assert!((a.gain - b.gain).abs() < 1e-8, "{}", case.name);
        }
    }
}

#[test]
fn recovered_device_notices_do_not_stop_audio_but_disconnect_does() {
    let mut c = cursor(vec![0.5; 32], Arc::new(AtomicU32::new(1)), 1);
    c.metrics.report(cpal::ErrorKind::Xrun);
    c.metrics.report(cpal::ErrorKind::RealtimeDenied);
    c.metrics.report(cpal::ErrorKind::DeviceChanged);
    let mut block = [0.0; 8];
    c.fill(&mut block, 2);
    assert_eq!(block, [0.5; 8]);
    assert_eq!(c.metrics.xruns.load(Ordering::Relaxed), 1);
    c.metrics.report_error(&cpal::Error::with_message(
        cpal::ErrorKind::DeviceNotAvailable,
        "Output disconnected",
    ));
    assert_eq!(c.metrics.detail.read(), "Output disconnected");
    c.fill(&mut block, 2);
    assert_eq!(block, [0.0; 8]);
    assert!(c.metrics.failed.load(Ordering::Acquire));
}
#[test]
fn audition_scale_project_compiles_and_renders_within_budget() {
    // D6 tripwire, not a benchmark: ~60x above droplet debug measurements
    // (compile ~2ms, render ~500ms for 232 tones / 1.6M frames).
    use std::time::Instant;
    let song = song_testkit::audition_song();
    let before = Instant::now();
    let schedule = Schedule::compile(&song, &opts()).expect("audition must compile");
    let compile_ms = before.elapsed().as_millis();
    eprintln!(
        "perf audition-compile: {compile_ms}ms tones={}",
        schedule.tones.len()
    );
    let before = Instant::now();
    let pcm = schedule
        .render(48000, || false)
        .expect("audition must render");
    let render_ms = before.elapsed().as_millis();
    eprintln!("perf audition-render: {render_ms}ms frames={}", pcm.len());
    assert!(compile_ms < 10_000, "compile budget");
    assert!(render_ms < 30_000, "render budget");
}
#[test]
fn reference_scale_project_is_explicitly_beyond_audition_bounds() {
    let song = song_testkit::reference_song();
    assert_eq!(
        Schedule::compile(&song, &opts()).unwrap_err().code,
        "audio_limit"
    );
}
#[test]
fn stress_scale_project_compiles_but_render_is_explicitly_bounded() {
    let song = song_testkit::stress_song();
    let schedule = Schedule::compile(&song, &opts()).expect("stress must compile");
    assert!(schedule.tones.len() >= 50_000);
    assert_eq!(
        schedule.render(48000, || false).unwrap_err().code,
        "audio_limit"
    );
}
