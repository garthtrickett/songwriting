# Desktop D1: native shell and Rust SAM foundation

This is a restricted desktop preview with an actual Tauri window. The Lit view
shows the starter's arrangement and relative 1–7 note editor. Rename the song,
drag a note horizontally, enter an exact fractional start, or undo a saved edit.
Rust owns the song and saves every accepted edit to local SQLite. No Neon sign-in,
account, model key, browser database or agent process is needed. Native audio,
Mastra and general project import remain outstanding. The browser app still works.

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
