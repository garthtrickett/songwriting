# D1 native audio proof — evidence

Status: implementation and local virtual-output proof complete. Physical-device coverage and
D1's remaining media/live-model gates are not complete. This slice builds on the
Rig proof; code integration does not close its live-model evidence gate.

## Delivered

- Pinned CPAL 0.18.2, a dedicated device worker and bounded preparation of mono PCM.
  Our data callback copies samples and updates atomic counters; it does not allocate,
  lock, call SQLite, invoke JavaScript or wait on a model.
- A committed Rust song/revision is the audition source. Exact rational timing
  survives arrangement/cycle expansion and chord-member offsets until conversion
  to absolute sample frames. C4 realizes the relative major-reference pitches.
- Play/restart, stop, discovery and explicit selected-device errors. The worker
  handles device stream failures; UI and Rig share host transport actions. The
  callback silences obsolete generations, including a start interrupted during a
  workspace read or preparation. Already queued device buffers can still drain.
- Edits during playback are saved immediately and affect the next audition.
  Renderer reconnect preserves native playback; process restart starts stopped.
  Natural completion emits silence until stop/replacement/close releases the stream.
- Rig journals an attempt before an ephemeral audio action. Resuming reuses that
  saved result rather than replaying the action. Musical receipt/undo rules remain
  unchanged. There is no promise of exactly-once physical audio delivery.

## Validation

Environment: Ubuntu 24.04 x86_64 droplet, Rust 1.97.1, Bun 1.4.2,
WebKitGTK native Tauri window; PulseAudio null sink. Initial runs used the ALSA bridge; final runs use CPAL’s direct PulseAudio backend.
This is an isolated virtual output, not a speaker/microphone or latency test.

| Command | Result |
| --- | --- |
| `bun run verify` | PASS: typecheck, 101 tests and production web build |
| `bun run verify:desktop` | PASS: Clippy, formatting, generated contracts, 30 Rust tests, 16 command steps, 20 exact-time cases and five audio reference cases |
| `bun run test:browser` | 31 passed initially; two existing 30-second timeouts during concurrent builds both passed in an isolated focused rerun (no assertion/timeout changes) |
| `bun run desktop:build --debug` | PASS: final-source unsigned Linux native executable |
| `xvfb-run -a dbus-run-session -- python3 scripts/desktop/audio-smoke.py src-tauri/target/debug/songwriter-desktop .agent/audio-buffer-native` | PASS: two consecutive final-source runs; `.agent/audio-buffer-native` and `.agent/audio-buffer-repeat` |
| `git diff --check` | PASS |

The TypeScript timeline independently generates baseline/member-offset/cut-tail/
repeated-section/muted fixtures. Rust matches their pitched starts, durations,
frequencies and gains. Other deterministic checks cover buffer-size invariance,
clamped finite samples, natural silence, old-callback fencing, unsigned PCM silence, recoverable CPAL notifications versus fatal disconnects,
missing outputs, preparation limits and cancelled generations. A Rig recovery test
loads an interrupted audio attempt and confirms the engine generation stays zero.

Final direct-backend runs used `pulseaudio:songwriter_proof`, 48 kHz stereo,
with a 4096-frame buffer request. Measurement starts after initial prefill and
asserts delivered audio/wall-time ratio is between 0.8 and 1.2 during the UI stall.
This tolerates buffer boundaries; it is not a physical DAC timing measurement.

| Run | Stall wall time | Frames supplied | Audio duration | Reported xruns |
| --- | --- | --- | --- | --- |
| First | 1.259 s | 65,685 | 1.368 s | 0 |
| Repeat | 1.322 s | 57,475 | 1.197 s | 0 |

Both runs passed selected/missing-device checks, play/restart/stop, saved manual
editing during playback, natural completion, renderer reload without restarting
transport, actual process kill/reopen starting stopped, existing native editing/
recovery assertions and cleanup of the isolated audio server. Raw JSON and native
screenshots are under the artifact directories above; `.agent/` is not committed.

## Remaining evidence and scope

- Repeat on physical outputs on ARM Linux, macOS and Windows; record device/backend,
  sample rate/buffer/latency and dropout behavior. Compile checks are insufficient.
- This proof does not measure physical DAC timing, hard real-time guarantees,
  end-to-end latency, sleep/device hotplug recovery on every platform or capture.
- Real-model invocation of the audio tools is pending the Rig credential gate.
  Deterministic model tests establish journal behavior, not actual model judgment.
- Explicit audition limits: 30 seconds, 2048 attacks/cycles, 120 cumulative voice
  seconds, 8–192 kHz and 32 channels. Normal/sustained pitched notes and members,
  zero-phase continuing occurrences, ring/cut releases and grouped clicks only.
  Unsupported semantics produce errors; there is no browser audio fallback.
- Full instrument synthesis, arbitrary musical playback, loops, seek and live
  schedule updates are D3. Decoder/capture feasibility is the next unfinished D1
  slice; full model/migration remains D2.

Reference: [CPAL's official documentation](https://docs.rs/cpal/0.18.2/cpal/).

## Linux backend correction

Repeated native tests reproduced intermittent `snd_pcm_avail_delay` I/O errors
from the ALSA PulseAudio bridge, including after a renderer reload. A standalone
probe could play repeatedly, so a single successful run was insufficient evidence.
The selected Linux integration now enables CPAL's direct PulseAudio backend for
PulseAudio and pipewire-pulse servers. Systems without a server retain ALSA.
Requested buffers use 4096 frames clamped to the reported supported range; unknown
ranges retain the device default. This bounds requests, not physical latency.

Recoverable CPAL notifications (xruns, default-route changes and unavailable
real-time scheduling) remain visible and do not force a fatal stop. Fatal errors
retain bounded backend detail using fixed atomic storage; formatting happens on
the control worker. No callback logging, allocation or locking was introduced.

The smaller 1024-frame direct-backend request did not sustain sufficiently regular
frame delivery on the loaded droplet. The proof uses conservative buffering; it
does not claim low-latency monitoring. CPAL and the sound server have their own
internal synchronization, so the application callback's bounded work is not a
hard real-time guarantee for the whole stack. D3 must measure/tune that behavior
on physical outputs before expanding playback claims.
