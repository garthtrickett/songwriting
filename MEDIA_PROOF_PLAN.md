# D1 — Native media compatibility and capture proof

Status: implemented and locally verified; measured evidence is recorded in
`docs/MEDIA_PROOF_VALIDATION.md`. This is a feasibility harness, not the D4 take
editor. D2–D7 stay planned. Parent audio/Rig proof gates remain open.

## Outcome and boundary

Use native Rust commands to preserve an imported recording, decode its audio,
record a short input-device take, and recover committed samples after killing
the process. Keep music editable independently: this proof uses its own temporary
profile and never changes workspace.sqlite or attaches a take to the fixture.
The CLI exercises a shared Rust media API; Tauri/Rig attachment and song placement
will use that API in D4 after this compatibility decision has evidence.

## Detailed implementation

1. Pin a minimal FFmpeg 9.0.1 executable for WebM/Opus, Ogg/Opus and MP4/AAC.
   Rust owns a bounded decoder subprocess off the real-time callback. A native
   WAV reader keeps capture recovery independent of FFmpeg availability. Build
   from checksum-verified source with network, GPL/nonfree components and external
   codec libraries disabled; retain source and notices with distributed binaries.
   Symphonia 0.6.1 plus libopus was evaluated first and rejected after both real
   WebM exports failed while FFmpeg decoded them.
2. Generate short, non-private sine recordings through real browser
   MediaRecorder/getUserMedia and the existing Recorder export path wherever the
   browser supports the format. Check in originals and provenance. Distinguish
   browser fixtures from encoder-generated supplemental coverage; do not claim
   Safari evidence from a synthetic AAC file.
3. Add a headless song-media crate and proof CLI. Preserve bounded original bytes
   under SHA-256 IDs before decoding. Store metadata/results in a separate SQLite
   journal. Unsupported/corrupt inputs remain exportable with an explanation.
   Decode to bounded interleaved f32 samples (25 MiB input, 60 seconds, stereo,
   8–192 kHz; compressed decoding has a 15-second deadline); report rate, channels, frames and
   signal measurements. Originals are immutable; no automatic garbage collection.
4. Capture through CPAL on the explicitly selected/default input, with no input
   monitoring. Use a preallocated SPSC ring; callbacks only convert/enqueue samples
   and set atomic fault flags. A non-callback worker commits PCM chunks and sample
   counts transactionally. Bound capture to ten seconds and stereo, report overflow,
   device failure, disk failure and missing inputs explicitly.
5. Persist capture identity/format before starting. Stop releases the device,
   drains the queue and finalizes a WAV asset only after validation and durable
   metadata commit. On restart, an unfinished capture remains interrupted until
   explicit recovery. Recovery uses committed chunks only and is idempotent;
   never restart a microphone from a checkpoint. Prevent another process from
   recovering a live capture using an OS-owned profile lock.
6. Prove real CPAL capture against an isolated virtual input fed a known tone;
   kill after a durable chunk, reopen, recover and verify the WAV sample count
   and signal. Also test malformed media, unknown device, capture identity reuse,
   queue overflow and failed writes. Physical microphone permissions and device
   behavior on ARM Linux/macOS/Windows remain separate evidence gates.

## Review refinements

- A successful decode is not evidence of gapless timing or sample-accurate take
  alignment. Measure codec delay/padding separately; do not discard originals.
- Configure FFmpeg to fail on reported decoding errors; retain the original.
  A successful tolerant demux does not certify source completeness. Cap input
  bytes, output bytes/frames, channels and process runtime. Restrict formats and
  protocols, pass no user-defined process arguments, and kill/reap on timeout.
- SQLite commits own durable chunks/counts; a callback counter is not a saved
  sample count. A process crash can lose the queue and the current transaction.
- The proof must not expand the restricted Rust song schema or expose temporary
  absolute file paths as agent tools. Full editor/agent media parity is D4 work.

## Exit evidence

Run focused Rust tests and the browser fixture/virtual-capture harness, then
`bun run verify`, `bun run verify:desktop`, relevant browser tests and whitespace
checks. Publish a draft PR based on the audio proof; track exact-head CI. Record
actual results, binary/dependency footprint and remaining target/codec gaps.
