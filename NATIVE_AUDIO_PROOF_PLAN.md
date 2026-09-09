# D1 — Native audio independence proof

Status: implemented; local verification and device evidence are tracked in
[the validation record](docs/NATIVE_AUDIO_PROOF_VALIDATION.md). D2–D7 remain planned.
This slice builds on the Rig proof; its live-model gate stays open after code integration.

## Outcome

Audition the local fixture using a simple pitched tone and an accented metronome.
Rust owns the schedule, device stream and transport. Lit displays state and sends
commands. Saving and agent requests do not run on the audio callback.

## Implementation

1. Add `song-audio`: a bounded, device-independent schedule compiler/renderer and a
   CPAL 0.18.2 device worker. On Linux, use its direct PulseAudio backend when a server is available (including pipewire-pulse), with ALSA for systems without one. Add ALSA development libraries to Linux CI/Nix.
   Request a 4096-frame buffer within the reported range, retaining defaults only when the range is unknown.
2. Read a committed song/revision through the workspace queue. Prepare the fixture
   arrangement with exact rational event positions, chord-member offsets, relative
   degrees (major-reference intervals, C4 audition tonic), repeating occurrences,
   and grouped clicks in its changing meters. Round absolute times to sample frames
   only at the render boundary. Reject unsupported semantics and oversized input.
3. Keep the callback free of allocation, locks, file/network work and UI calls.
   Bounded schedules are rendered to mono PCM before stream startup; the callback only copies prepared samples. Atomic generation
   fencing silences obsolete callbacks on stop/replacement. Device discovery,
   opening and stream destruction happen on a dedicated control worker.
4. Provide native status, output discovery, play/restart and stop through a shared
   host interface. Use CPAL device IDs resolved against current enumeration; an unavailable selection fails
   explicitly rather than silently using a different device. Reconnect reads the
   current transport; restart starts stopped. Musical edits are heard on next play.
5. Add compact Lit transport controls and visible failure/recovery. Keep stop
   available while a start is pending. Surface frame progress and the auditioned
   revision; editor state remains authoritative in Rust.
6. Expose the same transport primitives to the Rig runner. Playback is ephemeral:
   recovery must never unexpectedly restart audio. Musical edits retain their
   existing durable exactly-once receipts.

## Evidence and exit gates

- Deterministic renders: mixed-meter grouping, absolute sample timing, chord
  offsets, relative pitches, bounded polyphony, buffer-size invariance, natural
  end, stop/replacement fencing and silence on error.
- Device failures and no-device startup remain usable; no Web Audio fallback.
- Native-window proof: play, stall JavaScript, verify callback frame advancement,
  edit while playing, stop, reload and restart. Capture callback counters/rate and
  device details. A virtual output proves integration, not physical latency.
- Run `bun run verify`, browser checks, `bun run verify:desktop`, native smoke and
  exact-head CI. Record physical-device/ARM/macOS/Windows gaps honestly.

Full synthesis, live schedule replacement on edits, loops/seek, arbitrary schema-7
imports, decoder/capture work and latency guarantees belong to later milestones.
