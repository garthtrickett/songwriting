# Decoder fixtures

All audio is generated test sound, not recorded speech or third-party music.
`manifest.json` records source, browser/encoder versions, MIME, byte hashes and
expected native decoded frames/rate/channels/signal levels.

- Chromium and Firefox `*-recorder.webm`: generated microphone input through
  **the existing application's Recorder and capture_export tool**.
- `firefox-opus.ogg`: Firefox MediaRecorder with an explicit Ogg/Opus request
  and 200 ms chunks (the application's preferred format on this Firefox is WebM).
- `generated-aac.m4a`: 1.2-second 440 Hz generated tone encoded as AAC-LC.
- `generated-fragmented-aac.mp4`: the same generated tone, fragmented container.

The two AAC files are supplemental encoder fixtures, **not Safari recordings**.
Neither tested browser advertised AAC MediaRecorder support. Real Safari/iOS
export compatibility remains an open evidence gate.

Recreate browser bytes with a running `bun run dev` and
`node scripts/desktop/media-fixtures.mjs` (Playwright Chromium/Firefox installed).
Then run `python3 scripts/desktop/media-supplement.py` using a full encoder build.
Regeneration intentionally changes hashes/timing: inspect each result with the
pinned proof decoder and update manifest `expected` measurements after reviewing
them. Tests must fail while bytes/references are out of sync; CI never regenerates
them. Browser `decoded` duration is an independent cross-check where available.

Initial system FFmpeg 6.1.1 results are retained as `comparisonFfmpeg6`. In the
regular AAC container it emitted 58,368 frames versus the source's 57,600 frames.
Pinned FFmpeg 9.0.1 emits exactly 57,600, consistent with the independently probed
1.2-second container duration at 48 kHz. Fragmented AAC emits 59,392 frames;
priming/padding remains explicit and must not be confused with placement time.
The test retains exact frame assertions for every pinned fixture; it does not
round away that difference.
