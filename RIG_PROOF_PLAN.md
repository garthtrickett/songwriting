# D1 — Rig agent proof

Selected by the user on 2026-09-09. This replaces the next Node/Mastra packaging
milestone. D1 remains open until the real-model and native audio/device gates have
evidence. A deterministic fake model is recovery evidence, not a live evaluation.

## Outcome

In the existing Tauri/Lit preview, ask a model to inspect and rename the local
fixture using Rust commands. Interrupt the process after the edit commits but
before the agent receives the result. Reopen and explicitly resume: the saved
result is delivered, exactly one edit exists, and it can be undone. Manual edits
and cancellation remain responsive during a stalled model request.

## Architecture

- `song-agent` uses pinned Rig provider/message/tool contracts and an app-owned
  bounded loop. No Node runtime, Mastra, separate agent database or local HTTP
  server is needed for this proof. No framework code owns musical acceptance.
- Rig model requests run on async tasks outside the `song-session` workspace
  worker. All model-request completions carry task ID and execution generation.
- `song-workspace` journals the user request, provider/model identity, model-call
  count, assistant messages, pending tool calls and results in workspace.sqlite.
  Credentials are excluded. The existing database upgrades transactionally to v2.
- Before sending a model request, durably reserve one of 12 lifetime calls. Before
  dispatching effects, save the assistant response and its entire tool batch.
  Execute tools sequentially, with at most eight calls per batch.
- A musical action goes through the existing Rust `Envelope::accept` rules.
  Commit its candidate envelope/history/receipt and the corresponding tool result
  in the same SQLite transaction. Failed journal writes roll back the music too.
- On reopening, running tasks become interrupted and receive a new generation.
  Resume uses saved tool results without redispatching their actions, including
  when the writer has since edited or undone that music. Unfinished tool calls
  keep their original expected revision; conflicts go back to the model.
- Cancellation durably fences the generation before dropping the network future.
  Already committed edits remain visible and undoable. Nothing promises to
  retract a model request already received/billed by its provider.
- Completion is an explicit `complete_task` primitive. Text alone does not finish
  a task. Context is capped at 256 KiB/128 messages; each model call has a 60-second
  deadline and 2,048 output-token limit. No automatic retry on provider failure.
- This proof keeps at most 64 task records and the existing 256-operation fixture
  history limit. Scalable task management belongs to D5; full music parity to D2.

## Product and tool boundary

The assistant panel configures Anthropic or OpenRouter with a user-selected model
and session-only API key. Clear the password input after submission; never return
or persist keys. Settings explain that requests and inspected song content go to
the selected provider. Missing keys do not block local editing. OS credential
storage remains a later desktop task; do not claim persistent login/key recovery.

| Outcome | Primitive |
| --- | --- |
| Inspect current song, revision, notes/chords and undo IDs | `read_song` |
| Rename, move a note/chord member, undo | `edit_song` with the existing Rust `Action` |
| Report completion or an unsupported outcome | `complete_task` |

The renderer exposes only configure/status/start/resume/cancel commands. It never
receives checkpoint-write or arbitrary SQL/file access. Status includes the user
request, selected model, task status, model-call count and concise result/error.
D1 polls bounded task summaries; streaming and richer progress belong to D5.

## Implementation slices

1. Add a versioned journal and atomic edit/result transaction on the existing
   SQLite worker, plus generation fencing and restart reconciliation.
2. Connect Rig provider completions to the durable loop and shared Rust actions.
   Keep a fake provider seam for deterministic failure tests.
3. Add desktop configure/send/cancel/resume UI; generated wire types and runtime
   response checks protect the view from malformed task data.
4. Prove a real subprocess exit at the commit/before-reply boundary, recovered
   result replay, undo, intervening manual edits, failed task writes, unsupported
   tools, stale revisions, network failure and cancellation responsiveness.
5. Run an actual model on a disposable fixture, including interruption and resume;
   record provider/model, commands, outcome and limitations without credentials.
6. Validate web/native/Nix ARM builds, publish a PR and merge when checks pass.

## Acceptance and decision

- Actual model inspects and renames via the shared Rust action path.
- Process interruption loses the reply but not the edit or tool result.
- Resume delivers the saved result with exactly one musical receipt/history entry;
  no extra rename, including after an intervening manual edit.
- Undo restores the prior title; failed commits expose no partial change.
- A stalled provider cannot block manual editing or cancellation; late work from
  an old generation is rejected. Missing credentials/network leave editing usable.
- Existing musical, browser and native-window checks remain green; ARM Linux runs
  Rust/Nix validation. Record hardware/window evidence separately from compilation.

Keep the hosted Mastra prototype as historical reference. Reuse prompts, musical
capability designs and behavioral evaluations; do not delete hosted data or deploy
changes there. Rig is the selected proof candidate, not a claim that its full
agent-native release gate is already satisfied.
