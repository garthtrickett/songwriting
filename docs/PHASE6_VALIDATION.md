# Phase 6 validation

Date: 2026-09-07. Branch: `phase6`.

## Rationale and scope

Schema 6 separates content-addressed audio metadata from nondestructive takes.
Musical anchors use exact quarter fractions; source trims use seconds. Section
appearances repeat local takes without retiming or repitching recordings. IndexedDB
version 2 adds binary and capture stores without replacing songs or settings.
Staging precedes musical commits; undo/deleted snapshots/captures protect binaries.
Complete versioned bundles validate hashes, decoding and completeness before song
import. Explicit unused cleanup checks references in a single transaction.

`src/media/{library,recorder,workspace}.ts` owns durable bytes, microphone lifecycle
and shared operations. `src/song/media.ts` validates and places takes; model,
migrations and structural commands integrate them. `src/app/{media,takes}.ts`
provides ordinary controls and conflict-preserving drafts; timeline annotations,
agent discovery/tools and controller connect the same operations. Audio engine
mixes recorded buffers with locally synthesized instrumental timbres. CONTEXT,
PLAN Phase 6, PHASES, capability/tool docs and examples describe the delivered
behavior. No dependencies added; no registry exists in this project.

Recording uses an origin lock and explicit pending/recording/stopping/ready/error
states. Late permission grants are stopped after cancellation. Final data is saved
before readiness; failed library writes retain chunks for recovery/raw download.
Timeslices are not exact clocks, and chunks may need concatenation before decoding:
[MediaRecorder data availability](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event).
Browser permission remains authoritative:
[getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
Buffer scheduling uses the audio clock and source offsets:
[AudioBufferSourceNode.start](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start).

## Validation

| Command | Result |
| --- | --- |
| `bun install --frozen-lockfile` | PASS; unchanged dependencies |
| `bun run verify` | PASS; strict TypeScript, 71 tests, production build |
| `bun run test:browser tests/browser/media.spec.ts` | PASS; capture/media workflows also included in full run |
| `bun run test:browser tests/browser/arrangement.spec.ts` | PASS; six lyric/structure workflows |
| `bun run test:browser` | PASS; all 24 Chromium workflows |
| `git diff --check` | PASS |

Nine new domain/storage tests cover migrations, exact placement/repetition/seek,
trim validation, section variation, identity/corruption, complete bundle import,
staged audio on conflict, history/capture protection and database upgrade. Five
new Chromium workflows cover import/trim/bundle/reload/missing audio, actual audio
graph output and seek, final capture chunks, cross-tab exclusion, denial/delayed
permission cancellation, interrupted capture recovery and failed-save recovery.

The first full run exposed lyric drafts racing their own pending phrase edits.
Lyrics now submit field intentions through the existing own-operation queue,
retaining the draft's base revision. Foreign changes still reject and preserve
typed words. The regression adds deliberate 250 ms persistence latency; existing
foreign-change tests remain intact. A later run was interrupted by Vite hot reload
while error-message wording was edited; the final run uses unchanged source.

Native fake-device microphone capture was unavailable in this droplet's Chromium
(`NotSupportedError`). Tests therefore feed a generated Web Audio MediaStream
through the real MediaRecorder/codec/events/storage pipeline. Permission denial
and late grant are injected separately; interrupted chunks are a persisted fixture.
This is not evidence of a physical microphone, OS permission grant, mobile process
kill, or human listening test. Those remain device-validation limitations.

## Live agent evaluation

Task `31962cf3-5c22-468a-ba3f-7880dfc3f314` used the existing live browser bridge,
OpenAI / GPT-6 Codex (exact build unavailable). Twelve calls composed import,
mutations, media staging/attachment, bundle export/import and context before an
explicit completion. No demo-building tool was added. See
[record](agent-evaluation-phase6.json) and
[portable example](../examples/echoes-between-bars.songbundle.json).

The agent made a separate “Echoes between bars” composition from Capo conversations,
attached a generated three-second WAV at local quarter 1/3, trimmed offset to 0.25
seconds and duration to 1.25 seconds, repeated the eight-quarter section, and
round-tripped a complete bundle. Independent Python `hashlib`, `wave` and `Fraction`
checks verified identical original bytes/hash, source duration, trims and anchors
1/3 and 25/3. All original events, chords, patterns, voices, pattern occurrences,
fretted settings and fingerings remained equal. Eleven independent checks passed;
rendered UI was inspected. The tone is explicitly synthetic, not a vocal recording.

## Limits

25 MiB / ten minutes per asset; 50 MiB encoded audio per bundle plus base64 memory
overhead. Codec support depends on browser. Recordings retain their original key
and speed. A killed process may lose its latest unsaved chunk; incomplete codec
output may only be downloadable raw. Page-exit completion is best effort. History
protection intentionally retains audio after musical deletion. Browser storage is
local, not remote backup; device quotas are surfaced as recoverable failures.
