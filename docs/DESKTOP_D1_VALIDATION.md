# Desktop D1 — Rust SAM core and connected native window

Status: core and Tauri/Lit connection implemented; D1 remains in progress. This
is a restricted desktop preview, not a completed native agent/audio integration.

The next delivered feasibility slice is the standalone
[native media compatibility/capture proof](MEDIA_PROOF_VALIDATION.md). It selects
FFmpeg after real browser-format comparison and tests recoverable CPAL input;
it does not add media controls to the restricted desktop window or close physical
device, Safari, live-model or release-packaging gates.

## Delivered

- Rust 1.97.1 workspace with `song-core` independent of Tauri, storage and devices.
- Rust actions create private proposals; the model validates/accepts them and
  derives detached state. Supported actions: rename, move a note/chord member,
  and conflict-aware undo. No automatic next actions are needed by these operations;
  audio/agent effect and next-action machinery remains outstanding.
- Exact quarter-note rationals use bounded integers and i128 intermediates,
  matching the existing TypeScript time implementation for the tested operations.
- SQLite adapter commits song, revision, history and operation receipt atomically.
  Failed saves expose no candidate state. Retried operations are resolved before
  revision checks; different content under the same operation ID is rejected.
- Restricted schema-7 fixture validation preserves relative pitches, chord-member,
  voice and placement identities. It rejects unported features and unknown fields.
- A development fixture runner works without an agent process or remote service.
- `song-session` runs SQLite work on one dedicated bounded worker. Protocol and
  session-epoch checks reject old callers; app-data profile selection and the
  single-instance Tauri plugin establish one application owner. Shutdown drains
  accepted work before closing the process. Startup database errors are visible.
- Tauri hosts packaged local assets and only exposes read/dispatch commands to
  the main window. Event permissions allow subscription, not renderer emission;
  no filesystem, shell or remote capabilities are granted. No network login or
  agent process is needed. Rust projects arrangement and relative note DTOs.
- Generated TypeScript contracts and a small Lit client replace browser Controller
  authority for the desktop slice. Edits carry captured revisions and durable IDs;
  drag previews reconcile after success or rejection. Full snapshots subscribe
  before open, ignore older revisions and refresh on reconnect. Uncertain replies
  retain the identical request for receipt-first retry. Drafts survive incoming
  changes and conflicts; renderer/process restart restores saved music, not drafts.
- CI checks the entire Rust workspace, generated contracts and host on Linux,
  Windows and macOS, plus a Linux native WebDriver smoke test. macOS/Windows
  compilation is not runtime/device/installer evidence.

## Initial core slice validation

The branch is based on `main` at `33ef9b8`, not the hosted PR. Its actual browser
baseline is 90 unit tests and 33 browser tests. The earlier plan's 94/12/38 counts
refer to the separate hosted prototype and are not this branch's baseline.

Local environment: Linux x64, Rust 1.97.1, Bun 1.4.2; SQLite is bundled through
rusqlite with the Cargo lockfile committed. Dependency builds do not require a
system SQLite installation. No production resources or secrets were accessed.

Commands (Bun run through `npx --yes --package=bun@1.4.2 bun` on this machine):

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile` | PASS |
| `bun run verify` | PASS: typecheck, 90 unit tests / 566 assertions, production web build |
| `bun run verify:desktop` | PASS: formatting, Clippy with warnings denied, 10 Rust integration tests and fixture drift check |
| `bun run test:browser` | PASS: 33 Chromium browser tests |
| `git diff --check` | PASS |
| GitHub native matrix and browser verification | [Draft PR #12](https://github.com/garthtrickett/songwriting/pull/12); final status recorded on the PR |

Rust checks include 16 TypeScript command-sequence steps and 20 exact-time cases,
plus wire validation and unsupported/corrupt data rejection. The recovery tests
exercise a real child process exiting after SQLite commit but before its reply,
reopen/retry/undo, injected failed SQL writes, simultaneous independent connections,
history corruption, future schema rejection and non-destructive fixture startup.
The fault exits the process without unwinding Rust destructors; it does not prove
survival of hardware power loss or every operating system's filesystem behavior.

The initial Windows CI run found Git converting generated JSON fixtures to CRLF,
which correctly failed the byte-for-byte reference drift check. Reproduced locally
with `git -c core.autocrlf=true checkout-index`; `.gitattributes` now pins those
generated files to LF on every platform. Musical comparisons remain unchanged.

## Outstanding D1 work

- General asynchronous audio/agent effect scheduling and bounded next actions.
- Native audio implementation and virtual-device proof: see [audio evidence](NATIVE_AUDIO_PROOF_VALIDATION.md). Physical-device evidence and codec/capture feasibility remain outstanding.
- The Node/Mastra desktop proposal is superseded by [the Rig proof](../RIG_PROOF_PLAN.md).
  Its Rust journal/agent implementation and deterministic tests are documented in
  [Rig evidence](RIG_PROOF_VALIDATION.md); actual-model evaluation remains pending.
- Cross-platform packaged launch, footprint, real-device evidence and signing.

D2 still owns full musical model/analysis parity, browser history/media migration,
profile switching, backup/restore and scalable indexed receipt storage. The D1
runner's history cap and limited fixture cohort must not be mistaken for final
product limits. The existing browser retains its working implementation during
the port; desktop will not fall back to it as a second authority.

## Shell/view slice evidence

Toolchain: Tauri 2.11.5, CLI 2.11.4, frontend API 2.11.1, single-instance plugin
2.4.4, ts-rs 12.0.1; exact resolved Rust/JS dependencies are checked in. Local
native target: Ubuntu 24.04 x64, WebKitGTK 2.52.6, Xvfb and the system WebKitWebDriver.
The Linux native test launches the unsigned debug binary with compiled assets,
uses an isolated temporary app-data profile, and requires no Vite/bridge server.
It is not a release-size or real audio-device measurement.

The generated `Time` alias explicitly describes `[number, number]` because
serde's conversion attributes do not define a TypeScript shape. ts-rs reports
informational notices for `deny_unknown_fields` and conversion attributes it
ignores during generation; Rust serde still enforces them at runtime.

| Shell/view check | Result |
| --- | --- |
| `bun run verify` | PASS: typecheck, 95 unit tests / 587 assertions, production web build |
| `bun run verify:desktop` | PASS: desktop assets, formatting, Clippy, binding drift, 16 reference steps / 20 exact-time cases, 13 Rust tests |
| `bun run test:browser` | PASS: 33 existing Chromium tests |
| `bun run desktop:build --debug` | PASS: unsigned Linux executable with packaged assets |
| `xvfb-run -a dbus-run-session -- python3 scripts/desktop/native-smoke.py src-tauri/target/debug/songwriter-desktop .agent/native-smoke` | PASS: actual native window and Rust/SQLite path |
| Desktop dev entry with Chromium | PASS: entry/imports load; no native workspace is fabricated in a plain browser |
| `git diff --check` | PASS |

Native assertions cover default 1/3 snap display, local opening, second-instance
focus, rename, exact chord-member move with sibling timing preserved, negative
move rejection, foreign snapshot delivery with a retained stale draft, revision
conflict rejection, real pointer drag, rejected-drag rollback, Escape cancellation,
renderer reload, forced process termination, database reopening and undo.
`native-smoke.py` uses a private D-Bus session to identify its own app process,
checks its executable path and kills only that disposable process. WebKit's
session deletion only detaches automation, so it is not used as proof of app exit.
An initial CI push run exposed a dropped pooled connection in tauri-driver's
HTTP intermediary during a read, while the PR's identical native run passed.
The Linux harness now talks directly to WebKitWebDriver using the same binary
capability and automation environment used by tauri-driver 2.0.5. It drives the
same packaged Tauri window and performs all assertions without command retries;
no app behavior, assertions or native-window coverage were removed.

The Rust session tests additionally hold a committed response, disconnect its
renderer, queue another edit and close the worker; reopening confirms both edits.
They also check old epochs and an unreadable database without replacing its bytes.

Visual inspection found and fixed an initial select-menu mismatch (displayed 1/2
while the drag controller used 1/3). The native test now asserts the menu value.
The initial native compile required an icon; source SVG and generated desktop
icons are checked in. No failing check was skipped.

The local debug executable is approximately 253 MiB with symbols, and the frontend
bundle is approximately 24 kB JS plus 19 kB CSS before compression. These are not
release installer or runtime-performance measurements. CI's native job uploads
its screenshot and driver log; macOS/Windows runtime interaction, signing, release
footprint and real audio-device evidence remain unverified. Cross-OS CI and merge
status belong to PR #12; D1's full acceptance gate remains open.

## Read-only desktop media status (D1 slice, 2026-09-09)

The desktop client now surfaces `song_media::status` through a
`desktop_media_status` Tauri command: configured decoder, preserved-original
list and capture states from the app's own `profiles/default/media` profile,
shown in a read-only panel beside native playback. The shared crate gained a
read-only `Store::assets` listing and a `Store::open_named` profile-stem helper
(the proof CLI keeps its `media-proof` files); no command records, imports or
mutates song state, and the restricted song schema is unchanged. Recording
controls, take CRUD and revision-checked attachment stay D4 work.

Validated locally with `bun run verify` (typecheck, 104 TypeScript tests
including 3 new media boundary/client tests, production build) and the full
pinned-decoder `bun run verify:desktop` (formatting, Clippy, contract check and
the workspace Rust suite including the new status/assets regression test).
Physical microphones, Safari exports and live-model evidence remain open.
