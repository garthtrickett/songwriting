# Desktop D1 — first headless SAM slice

Status: first core slice implemented; D1 remains in progress. This is not a
packaged desktop release or a completed native agent/audio integration.

## Delivered

- Rust 1.97.1 workspace with `song-core` independent of Tauri, storage and devices.
- Rust actions create private proposals; the model validates/accepts them and
  derives detached state. Supported actions: rename, move a note/chord member,
  and conflict-aware undo. No automatic next actions are needed by these operations;
  the asynchronous effect/next-action machinery remains with the host work.
- Exact quarter-note rationals use bounded integers and i128 intermediates,
  matching the existing TypeScript time implementation for the tested operations.
- SQLite adapter commits song, revision, history and operation receipt atomically.
  Failed saves expose no candidate state. Retried operations are resolved before
  revision checks; different content under the same operation ID is rejected.
- Restricted schema-7 fixture validation preserves relative pitches, chord-member,
  voice and placement identities. It rejects unported features and unknown fields.
- A development fixture runner works without an agent process or remote service.
- CI adds native core tests for Linux, Windows and macOS. These check the Rust
  library/runner, not native windows, audio devices or signed installers.

## Validation

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

- Tauri window, local-profile lifecycle/epoch and one-application ownership.
- Generated TypeScript contracts, Lit view adapter, drag preview reconciliation,
  production IPC, state subscription/reconnect and asynchronous effect scheduling.
- Native audio callback, prepared schedules, device and codec/capture feasibility.
- Packaged Node/Mastra with local SDK snapshots, full commit/task-result integration
  and an actual model evaluation through the shared Rust interface.
- Cross-platform packaged launch, footprint, real-device evidence and signing.

D2 still owns full musical model/analysis parity, browser history/media migration,
profile switching, backup/restore and scalable indexed receipt storage. The D1
runner's history cap and limited fixture cohort must not be mistaken for final
product limits. The existing browser retains its working implementation during
the port; desktop will not fall back to it as a second authority.
