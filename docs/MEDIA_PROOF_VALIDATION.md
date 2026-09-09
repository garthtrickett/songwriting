# D1 media compatibility and native capture evidence

Status: implemented and locally verified; draft publication/CI tracked below. This standalone
proof does not complete D1 or add desktop recording controls. See
[the selected scope](../MEDIA_PROOF_PLAN.md) and [decoder decision](FFMPEG.md).

## Delivered

- `song-media`: Rust-owned input discovery, bounded recording, preserved-original
  imports/exports, decode inspection and explicit capture recovery. No song edits,
  browser audio capture or hosted service is involved in its native path.
- Separate `media-proof.sqlite` (version 1, WAL, synchronous FULL), exclusive OS
  profile lock, transactional PCM chunks/frame counts and SHA-256 original assets.
  Unknown future schema versions reject. No destructive cleanup/GC is provided.
- CPAL captures into a preallocated one-second SPSC ring. A non-callback worker
  commits at most 4096 frames per transaction. No callback allocation, database
  operation, file IO or lock. Library/device internals have their own behavior;
  this is not a hard-real-time guarantee.
- A ten-second capture cap and mono/stereo 8–192 kHz bounds. Stop drains complete
  frames and closes input. Error/overflow/stall preserves an interrupted prefix.
  Device-open cancellation checks again before starting. No input monitoring.
- Recovery never restarts input. It validates committed chunks, writes a float
  WAV, checks decoded frame/format identity and marks ready. Repeating recovery
  returns the same verified original. Raw checkpoints and interruption reasons
  remain retained. A process crash can lose queued/uncommitted samples.
- Pinned minimal FFmpeg 9.0.1 source build and Nix development dependency; Hound
  handles native WAV independently. Unsupported originals remain exportable with
  a decode error. FFmpeg invocation has fixed arguments, no shell/network protocol,
  bounded output/diagnostics and kill/reap on timeout.

## Verification record

Local host: Ubuntu 24.04, x86_64 droplet, Rust 1.97.1. Completed evidence:

- `bun run verify`: passed, 101 TypeScript tests and production build.
- `bunx playwright test tests/browser/media.spec.ts`: all five passed, including
  denied/cancelled permission, final chunks, interruption and failed-save recovery.
- Browser fixture generation used actual Chromium 153.0.8010.12 and Firefox 155.0
  with fake microphone signals, through the app's recorder/export path. Supplemental
  Ogg used explicit Firefox MediaRecorder settings. AAC fixtures are generated,
  not Safari evidence. Originals/provenance live in `tests/desktop/media`.
- `bun run build:decoder`: passed using the final minimal 9.0.1 recipe. Executable
  size **2,730,336 bytes (2.60 MiB)**; source archive 12,036,420 bytes. `ldd` lists
  only libc/libm/the system loader. This is a decoder measurement, not a finished
  desktop-installer footprint.
- `SONGWRITER_FFMPEG="$PWD/.agent/ffmpeg-proof/ffmpeg" CARGO_BUILD_JOBS=2 CARGO_INCREMENTAL=0 bun run verify:desktop`:
  passed: formatting, Clippy, generated binding/fixture checks and **40 Rust tests**.
  The five compressed fixtures passed against the final pinned decoder. Existing
  ts-rs serde-attribute warnings remain; contract comparison passes.
- `SONGWRITER_FFMPEG=/deliberately-unavailable-decoder python3 scripts/desktop/media-smoke.py src-tauri/target/debug/song-media .agent/media-final-native`:
  passed with a real CPAL input stream on an isolated PulseAudio monitor fed a
  generated 440 Hz tone. A normal two-second stereo capture saved **96,000 frames**
  at 48 kHz. A deliberate process exit (73) after its first durable checkpoint
  recovered **4,096 frames**, with identical identity on repeat recovery. An early
  stop finalized **6,462 frames**. Unknown inputs and capture-ID reuse rejected.
  WAV recovery succeeded with FFmpeg deliberately unavailable. This is synthetic
  source/virtual-device evidence, not physical microphone evidence.
- `nix flake check --all-systems --no-build`: passed evaluation for x86 Linux,
  ARM Linux and Apple Silicon. Actual Nix builds are delegated to the existing
  x86/ARM CI matrix; evaluation alone is not a build claim.
- Python/JavaScript harness syntax checks and `git diff --check`: passed.

Local logs: `.agent/media-desktop-verify.log`, `media-web-verify.log`,
`media-browser.log`, `media-ffmpeg-final-build.log`, `media-final-native.log` and
`media-final-native/capture.json`. These are ignored local artifacts, not user data.

The first cross-version AAC assertion failed because system FFmpeg 6 included
padding which the pinned decoder removes. The corrected regular-AAC reference
is independently supported by its generated 1.2-second source and MP4 duration;
exact frame assertions remain in place. The older decoder measurements remain
in the fixture manifest for comparison.

## Try the proof

In `nix develop`, FFmpeg is built/provided automatically. Outside Nix:

```sh
bun run build:decoder
export SONGWRITER_FFMPEG="$PWD/.agent/ffmpeg-proof/ffmpeg"
```

Windows uses MSYS2 UCRT64 to build; set the variable to the resulting `ffmpeg.exe`.
Use a disposable directory for these commands:

```sh
bun run desktop:media -- inputs
bun run desktop:media -- capture .agent/my-media-proof idea-1 2
bun run desktop:media -- captures .agent/my-media-proof
bun run desktop:media -- recover .agent/my-media-proof idea-1
bun run desktop:media -- import .agent/my-media-proof /path/to/recording.webm
bun run desktop:media -- decode /path/to/recording.webm
```

Capture defaults to the system input; append a listed input ID to select one.
It records for the requested 1–10 seconds, without monitoring through speakers.
Ctrl-C/process termination retains previously committed chunks for explicit
recovery. New captures require new IDs. Export an original with
`desktop:media -- export PROFILE HASH NEW_FILE`; an existing file is never replaced.

## Remaining evidence and scope

Physical microphones, permission UX and device changes on ARM Linux, macOS and
Windows remain unverified. This droplet's virtual input proves actual CPAL and
process integration, not physical latency or microphone permissions. Cross-target
CI builds and decoder tests do not close those hardware gates.

Real Safari/iOS AAC exports, additional variants/channel layouts, long recordings,
sample-accurate codec trim/alignment, normalized playback caches and media bundle
migration remain future evidence/integration. Compressed decoding success does
not certify a complete undamaged original. Process-kill durability is tested;
power-loss behavior and Windows directory durability need platform evidence.

The media harness is not wired into the Tauri/Rig workspace. D4 must bring the
shared API into both clients, add full media controls/CRUD and attach assets through
revision-checked Rust musical commands. Decoder sidecar packaging, signing,
Windows runtime dependencies and installer footprint are still release gates.
Parent Rig real-model and native-audio physical-output gates remain open.
