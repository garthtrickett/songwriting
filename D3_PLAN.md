# D3 — Native instrumental playback

Active as of 2026-09-10 by operator selection, alongside D6. Slices land in
order with their evidence; D4–D5 and D7 remain planned and unactivated.

## Outcome

The desktop plays the full current audible surface without the D1 audition
restrictions: guitar/bass/drum/voice synthesis with expression, exact
schedules against shared fixtures, metronome, seek, device selection and a
throttled level meter. Playback of recorded takes stays D4 work.

## Starting inventory

- `Schedule::compile` is a D1 audition: sine-only tones, no drums, no
  non-normal articulations, no phases/boundaries, absolute pitch mapping,
  fixed gains, custom click sounds, 30 s / 2048-tone caps.
- The browser engine (`src/audio/engine.ts`, `instruments.ts`) is the
  reference: `sounds()` expansion, tonic-relative pitch (default 48),
  gain × 0.2, per-instrument periodic waves, kick ramp, snare/hat noise,
  ADSR-ish envelopes, metronome clicks, seek-from playback.
- Transport (`Engine`) is generation-fenced with device selection, offline
  render and a copying cursor. `AudioPlay` carries only a device id.

## Slices

1. **Schedule from sounds.** Rebuild `Schedule::compile` on the canonical
   `song_core::sounds()` expansion (phases, boundaries, tails, rest
   trimming, expression-resolved durations/gains), plus `clicks()` for the
   metronome. Adopt the reference formula (tonic-relative pitch, gain
   scaling, click sounds) and regenerate `audio.json` as a documented
   cutover. Raise bounds substantially with documented limits.
2. **Instrument synthesis.** Port periodic-wave partials, kick pitch ramp,
   seeded noise with highpass filters, and per-kind envelopes into the
   offline renderer. Unit-test primitives (partials, determinism, envelope
   shape, ramp endpoints, bounded finite output); schedule-level
   differentials cover timing, frequency and gain. Bit-parity with Web Audio
   float paths is explicitly not claimed.
3. **Transport controls.** Seek-from playback, metronome toggle and playback
   key through `AudioPlay` into the engine, cursor and desktop panel, plus a
   throttled output level in the view. Device enumeration/selection stays as
   D1 built it; hardware behavior remains explicitly unevidenced.

## Interface rules

- No Web Audio fallback and no bundled samples: synthesis stays procedural.
- Takes are scheduled by the browser engine but skipped natively until D4;
  the native schedule records their absence rather than failing.
- Caps stay explicit and documented; they are resource bounds, not musical
  limits to work around silently.
- Backend/device timing claims stay out: native code alone establishes no
  latency guarantee (that evidence is D6's, also active).

## Exit evidence

- Exact schedule comparisons against regenerated `audio.json` fixtures
  (odd/additive meters, tuplets, independent cycles, overlapping members,
  pedal voices, seek trims, articulation, tonic and tempo).
- Synthesis primitive tests plus bounded-output properties.
- Transport tests: seek offsets, metronome on/off, tonic transposition,
  device-error paths, generation fencing.
- `bun run verify`, full pinned-decoder `verify:desktop`, CI matrix green;
  results in `DESKTOP_D3_VALIDATION.md`.

## Non-goals

D4 recording/takes/caches, D5 agent workflow, D7 installers/signing, and
real-device timing/dropout proof (needs hardware).
