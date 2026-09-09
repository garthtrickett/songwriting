# Desktop D1: native shell and Rust SAM foundation

This is a restricted desktop preview with an actual Tauri window. The Lit view
shows the starter's arrangement and relative 1–7 note editor. Rename the song,
drag a note horizontally, enter an exact fractional start, or undo a saved edit.
Rust owns the song and saves every accepted edit to local SQLite. No Neon sign-in,
account, model key, browser database or agent process is needed. Native audio,
the live Rig proof and general project import remain outstanding. The browser app still works.

- `song-core`: exact musical time, a restricted schema-7 model, named actions,
  private proposals, validation/acceptance, undo and detached state representations.
- `song-workspace`: serializes read/accept/commit through SQLite transactions,
  exposes state only after successful persistence, and recovers durable receipts.
  `song-session` calls it on a dedicated worker, outside UI/audio threads.
- `song-session`: bounded worker queue, local session epoch, typed action/state
  contract, Rust view projections and post-commit state notifications.
- Tauri host: local app-data profile, single-instance ownership, minimal renderer
  capabilities and queue-draining shutdown. Lit imports generated DTOs and the
  Tauri transport; it does not instantiate the old TypeScript Controller.
- `song-workspace` binary: a development-only line-based fixture runner. It loads
  the checked-in mixed-meter fixture, accepts actions on stdin and returns JSON.
  It is not the future production IPC protocol or a general song importer.

## Run the desktop preview

### Nix / NixOS (including ARM Linux)

From the repository root:

```sh
nix develop
bun install --frozen-lockfile
bun run desktop:dev
```

`nix develop` automatically selects your machine's architecture. The flake supports
ARM Linux (`aarch64-linux`), x86 Linux and Apple Silicon macOS. It provides Rust
from `rust-toolchain.toml` (including Cargo, rustfmt and Clippy), Bun from
`.bun-version`, a C linker, pkg-config and the platform's Tauri libraries. No
separate Rust installation is needed. The lockfile pins nixpkgs and rust-overlay;
Bun's upstream release archives are hash-pinned and patched for Nix.

Run all three commands in the same terminal. `exit` leaves the development shell.
If Nix says flakes are disabled, enter it with
`nix --extra-experimental-features 'nix-command flakes' develop` instead.
Check `rustc --version` and `bun --version` inside the shell when troubleshooting;
a globally installed older Bun outside the shell is not the project version.

The Linux shell includes GTK 3, WebKitGTK 4.1, libsoup 3, OpenSSL, AppIndicator,
libxdo (from xdotool), GLib network modules and settings schemas. Run the window
in your normal graphical desktop session. This is a development environment,
not an installer or a replacement for the host's display server/graphics driver.

When changing `.bun-version`, update `nix/bun.nix`'s release hashes too. When
changing the Rust version, update `rust-overlay` in `flake.lock` if necessary.
`nix flake check --all-systems --no-build` evaluates every supported shell; CI
also builds/tests the desktop through Nix on real x86 and ARM Linux runners.

### Without Nix

Install Bun 1.4.2, rustup, and the native [Tauri prerequisites](https://tauri.app/start/prerequisites/)
for your OS (Linux needs WebKitGTK 4.1 development libraries; Windows needs MSVC
build tools and WebView2; macOS needs Xcode command-line tools). Then from the repo:

```sh
bun install --frozen-lockfile
bun run desktop:dev
```

`bun run desktop:build` creates an unsigned executable with the compiled Lit assets
inside; no Vite server or installed JS runtime is needed to launch that executable.
It does not create installers yet. `bun run desktop:build --debug` builds the same
packaged-asset route without release optimization, for native smoke tests.

The preview creates one default profile at the OS app-data directory for
`com.songwriter.desktop.d1`, under `profiles/default/workspace.sqlite`. It loads
the starter only when that database has no song; it never overwrites an existing
workspace. An unreadable database produces a startup error. OS account permissions
protect the profile; this is not a separate login or encrypted storage.

## Contracts and verification

`bun run bindings:desktop` regenerates `src/generated/desktop` from Rust using ts-rs.
`bun run verify:desktop` checks the generated files, TypeScript reference fixtures,
Rust formatting, Clippy and all workspace tests. Snapshot DTO validation protects
the renderer; musical acceptance happens only in Rust. A captured-revision conflict
keeps the user's draft. An uncertain save retains its original request for retry.
A full renderer restart reloads saved state; unsent drafts are not durable yet.

Linux native test (install `webkit2gtk-driver`, Xvfb and D-Bus):

```sh
bun run desktop:build --debug
xvfb-run -a dbus-run-session -- python3 scripts/desktop/native-smoke.py src-tauri/target/debug/songwriter-desktop
```

The test uses an isolated temporary OS app-data profile and writes its screenshot
and driver log under ignored `.agent/native-smoke`.

## Headless fixture runner

From the repository root:

```sh
bun install --frozen-lockfile
bun run verify:desktop
mkdir -p .agent
bun run desktop:fixture .agent/desktop-fixture.sqlite
```

Paste an action after the initial `ready` state:

```json
{"songId":"desktop-fixture","expectedRevision":0,"operationId":"move-1","label":"Move note to a tuplet","action":{"kind":"moveNote","eventId":"note","memberId":null,"start":[2,3]}}
```

Restart the runner against the same file to see the saved state. Repeating that
exact action returns the current state without repeating the edit, even after
other edits. Changing the content under the same operation ID is rejected.
To undo it at revision 1:

```json
{"songId":"desktop-fixture","expectedRevision":1,"operationId":"undo-1","label":"Undo move","action":{"kind":"undo","targetId":"move-1"}}
```

Use the revision shown in the latest state for new edits. `rename` takes a `title`;
`moveNote` takes an event ID, optional chord member ID and normalized exact start.
UI and agent adapters will both dispatch these named actions. They cannot supply
preaccepted changes or mutate the authoritative model through a state snapshot.

The `--exit-after-commit` option is a test fault: it exits with code 73 after a
successful commit and before replying. It exists only in this fixture runner.

## Scope and compatibility

The song fixture includes 7/8 grouped 2+2+3 followed by 5/4, a relative note at a
tuplet position, a three-member chord and a stable guitar voice/placement. Moving
a chord member earlier adjusts the event anchor and makes the other members'
timing explicit, preserving their attacks and durations as the TypeScript editor does.

Only rename, move-note/member and undo are exposed. The initial validator supports
patterns, events, chords, bars, sections, arrangement, parts, voices and placements.
Nonempty media/harmony/fretted/annotation/prompt tables, lineage and optional member
expression fields are not supported in this slice. Unknown fields are rejected,
not silently stripped. Do not use this to import real projects yet.

Desktop envelope version 1 is separate from song schema 7. Its receipts store the
typed Rust request, not the old browser command's JSON fingerprint. Browser history
migration remains D2 work. Request IDs follow the song entity ID grammar; field
ordering in JSON does not change operation identity. Full history is validated by
reverse/replay on read and is capped at 256 actions for this disposable slice.
Indexed receipts, efficient snapshots and large-project limits remain D2 work.

The checked-in reference cases are generated by the existing TypeScript musical
implementation. `bun run fixtures:desktop` regenerates them; `verify:desktop`
checks that they are current before comparing the Rust results. It compares full
resulting songs using compact reference deltas, including unchanged identities.
JSON `112` and `112.0` are equivalent BPM values; exact-time pairs remain strictly
bounded, normalized integers. This proves the selected cohort, not all schema-7
behavior or playback expansion limits.

See [D1 evidence](../docs/DESKTOP_D1_VALIDATION.md) for checks and outstanding work.

## Rig assistant proof

The desktop assistant accepts an Anthropic or OpenRouter model ID and your API
key. Credentials last only for the app session; re-enter them after restarting.
Requests and inspected song content are sent to that provider. The assistant uses
the same Rust rename/move/undo actions as the view. Saved edits appear in History.
Cancel preserves saved edits; interrupted tasks offer Resume after configuration.
Model calls are limited to 12 per task, with a 60-second timeout per call.

For a reproducible **live-model** test against a new disposable database, set
`SONGWRITER_AGENT_PROVIDER`, `SONGWRITER_AGENT_MODEL`, and `SONGWRITER_AGENT_KEY`
in your shell using your normal secret manager. Never commit them or pass the key
as a command argument. Then, inside `nix develop`:

```bash
cargo run --manifest-path src-tauri/Cargo.toml -p song-agent --bin song-agent-proof -- .agent/rig-live.sqlite start --exit-after-edit
# Exit 73 is intentional: the edit/result committed, but the agent got no reply.
cargo run --manifest-path src-tauri/Cargo.toml -p song-agent --bin song-agent-proof -- .agent/rig-live.sqlite inspect
cargo run --manifest-path src-tauri/Cargo.toml -p song-agent --bin song-agent-proof -- .agent/rig-live.sqlite resume
cargo run --manifest-path src-tauri/Cargo.toml -p song-agent --bin song-agent-proof -- .agent/rig-live.sqlite undo
```

Expect revision 1/title `Crooked Steps` before and after resume, then revision 2
and the original title after undo. The crash command refuses an existing database.
This harness uses a separate fixture path; it does not open your desktop profile.
A fake model test is separate recovery evidence and does not satisfy the live gate.

## Native audition proof

`bun run desktop:dev` now includes Play sketch, Stop audio and output selection.
The Nix shell includes ALSA on Linux (including aarch64-linux); enter `nix develop`
again after pulling this change. Debian/Ubuntu builds need `libasound2-dev` in
addition to the existing Tauri dependencies. No model key is needed for playback. Linux uses CPAL’s direct PulseAudio backend when a PulseAudio/pipewire-pulse server is available, otherwise ALSA.

The D1 audition uses simple tones in C4 and grouped metronome clicks, with a
30-second bound. It plays the committed revision shown in the transport. Editing
remains available while playing; press Play again to hear the changes. Unsupported
music or unavailable outputs produce an error. Full instruments and live schedule
updates arrive in D3. Natural completion leaves an open silent stream until Stop,
replacement or app exit so the last queued sound is not truncated.

Linux integration proof (virtual output, not physical latency):

```sh
bun run desktop:build --debug
# Requires pulseaudio, libasound2-plugins, WebKitWebDriver, Xvfb and dbus-run-session.
xvfb-run -a dbus-run-session -- python3 scripts/desktop/audio-smoke.py src-tauri/target/debug/songwriter-desktop .agent/audio-native
```

The harness creates and destroys its own PulseAudio null sink and temporary local
profile; it does not change system sound settings. See NATIVE_AUDIO_PROOF_PLAN.md
and docs/NATIVE_AUDIO_PROOF_VALIDATION.md for scope and outstanding device evidence.
# Media feasibility commands

The D1 media harness is separate from the desktop window. It preserves imported
recordings and proves short CPAL capture/recovery through a Rust API and CLI.
See [commands and evidence](../docs/MEDIA_PROOF_VALIDATION.md) and
[the pinned FFmpeg decoder recipe](../docs/FFMPEG.md). `nix develop` provides the
decoder on ARM/x86 Linux and Apple Silicon. Outside Nix, run
`bun run build:decoder` and set `SONGWRITER_FFMPEG` to its resulting executable
before the compressed-format tests. No FFmpeg install is needed for WAV capture
recovery. Desktop recording controls and take placement remain D4 work.
