# Desktop D3 — Native instrumental playback

Status: slices 3a–3c implemented and merged (PRs #36, #37). The desktop plays
the full audible surface through procedural synthesis with expression,
seeking, metronome, device selection and a throttled level meter. Take
playback stays D4 work.

## Delivered slices

- **Schedule from sounds (3a):** `Schedule::compile` renders the canonical
  `song_core::sounds()` expansion (phases, boundaries, tails, rest trimming,
  expression-resolved durations/gains) plus `clicks()`, replacing the D1
  bespoke loop and its unsupported-error paths. Formula cutover, documented:
  tonic-relative pitch (default key 48, was absolute), gain × 0.2 (was × 0.1)
  and reference click sounds; `audio.json` regenerated, no other fixture
  changed. Bounds raised and documented (600 s / 65536 tones); click
  durations are microsecond-exact rationals, sub-frame at every rate.
- **Instrument synthesis (3b):** periodic-wave partials per voice, kick
  exponential ramp, seeded deterministic noise with RBJ highpass for
  snare/hat, and per-kind ADSR-ish envelopes. Shapes mirror the browser
  engine; float bit-parity with Web Audio paths is explicitly not claimed.
- **Transport controls (3c):** seek-from quarters, metronome toggle and
  playback key through `AudioPlay` into compile, cursor and panel; Rig tool
  message updated. Output level (callback RMS) surfaces in the view at poll
  cadence with a meter in the panel.

## Evidence

- Exact schedule comparisons against regenerated `audio.json` (all five
  variants), plus unit coverage for mixed meters, tuplets, independent
  cycles, phased occurrences, drums, articulations, seek trims, tonic
  mapping and the long-song limit.
- Synthesis primitive tests (partial energy, noise determinism/filtering,
  ramp endpoints, envelope shape) and bounded finite output properties.
- Transport tests: fencing, device errors, seek offsets, option passthrough,
  level validation.
- `bun run verify`, full pinned-decoder `verify:desktop`, CI matrix green
  per pull request.

## Known boundaries

- No Web Audio fallback and no bundled samples; synthesis stays procedural.
- Takes are skipped natively until D4 (recorded, not failed).
- Caps are resource bounds (600 s render, 65536 tones, 120 s render budget),
  not musical limits.
- Backend/device timing claims stay out: real-device behavior needs hardware
  (D6 measures responsiveness; dropout proof needs devices).
