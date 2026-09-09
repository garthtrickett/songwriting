# D1 Rig proof evidence

Status: implementation and deterministic recovery proof are under validation.
The **actual-model gate is pending**: no provider API key is configured in this
workspace. No live-model success, complete D1 or full desktop agent parity is
claimed. Selected scope: [RIG_PROOF_PLAN.md](../RIG_PROOF_PLAN.md).

## Implemented behavior

- Pinned `rig-core` 0.42.0 supplies provider requests, tool definitions and message
  serialization. The app-owned Rust loop handles durable task execution.
- Anthropic/OpenRouter configuration with session-only keys; no Node/Mastra
  process, Postgres connection or agent.sqlite is added to the desktop app.
- `read_song`, shared `edit_song` actions (rename/moveNote/undo), explicit completion,
  bounded context/request count, timeout, cancel and resume.
- SQLite v1→v2 adds a task journal transactionally without replacing songs or
  receipts. Both UI and agent call the same musical persistence function. Agent
  results commit in the musical transaction. Older binaries reject v2 databases;
  this change does not implement downgrade migration.
- Local Tauri panel displays task summaries and offers send/cancel/resume; provider
  errors are sanitized and keys are never included in returned state/checkpoints.

## Deterministic evidence

`cargo test --manifest-path src-tauri/Cargo.toml -p song-agent -p song-workspace -p song-session`
passes locally on Linux x64. Added cases cover:

- A real child process exits with code 73 from the post-commit notification, before
  the awaiting agent receives its tool reply. Reopen marks the task interrupted.
  After a manual title edit, resume delivers the original saved result, completes,
  and leaves exactly one agent receipt plus the manual receipt.
- A stalled fake provider leaves a manual edit and cancellation responsive within
  a two-second test deadline. Late checkpoint/tool requests from its generation
  fail. This is a liveness assertion, not a latency benchmark.
- Missing credentials/network failures preserve manual editing. Text without
  `complete_task` cannot falsely finish, and the 12-call budget cannot be reset by
  resume.
- A failed task-result SQL write rolls back both song and task; retry commits once.
  Undo still works, and replay after undo never re-applies the original edit.
- Stale revisions and unsupported tools return durable errors; tool batches stay
  ordered. Database migration preserves prior music and history.
- A local HTTP fixture exercises Rig's real OpenRouter request/response adapter
  and verifies provider tool IDs after checkpoint serialization. This is protocol
  evidence, not a real model evaluation.

`bun run verify` passes: typecheck, 98 unit tests and production build. New client
tests reject malformed task summaries, contain polling/action failures, and target
cancellation by task identity. Browser and full desktop checks are recorded on the
PR when they finish. No existing assertions are removed.

## Live proof procedure and remaining evidence

[src-tauri/README.md](../src-tauri/README.md#rig-assistant-proof) documents the
`song-agent-proof` harness. Supply the provider/model/key through the host
environment, then run start with `--exit-after-edit`, inspect, resume and undo on
a new disposable database. Expected title/revision: `Crooked Steps`/1 before and
after resume, then the original title/2 after undo. Record the actual provider,
model, requests and outputs without credentials before closing the live gate.

The native-window test checks the assistant panel and rejected start without keys,
then retains its real edit/drag/restart/undo assertions. Nix ARM/x86 CI and existing
Linux/macOS/Windows checks remain required. Native audio, real-device evidence,
full musical import/model parity, OS credential storage, streaming responses and
full D5 task workflows remain outside this proof.

## CI portability correction

The initial macOS push job failed in the mock HTTP provider's `read_line` with
`WouldBlock`, while the identical PR job passed. Accepted sockets may inherit a
nonblocking listener's mode on BSD/macOS, unlike Linux. A local reproduction with
an explicitly nonblocking accepted socket showed the same immediate error despite
setting a read timeout. The fixture now explicitly sets blocking mode before its
bounded reads; the focused Rig protocol test passes. No assertion or production
provider behavior changed. Final cross-platform results are recorded on PR #14.
