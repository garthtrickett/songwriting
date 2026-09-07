# Phase 7 validation

Date: 2026-09-07. Branch: `phase7`.

## Implementation rationale and files

Schema 7 adds project `writing` metadata and reusable `prompts` entities. This
keeps instructions/preferences and requests portable, inspectable, revision-checked
and undoable without introducing another competing state store. Migrations add
empty defaults to schemas 1–6 while keeping existing musical data and operation
fingerprints. Ordinary editors preserve dirty drafts; prompt use fills an editable
request. Three starting recipes reflect previously exercised musical workflows.
Task creation snapshots the selected request, guidance and source revision.

`src/agent/context.ts` provides bounded summaries/search with totals, continuation
offsets and optional expected song/revision checks. Explicit entity/document reads
and receipt detail retain access to full content. `src/agent/writing.ts` handles
portable guidance and starting recipes; model/migration/validation/commands and
agent discovery expose them. `src/app/writing.ts` provides ordinary customization.

`server/task-store.ts` owns serial, atomic task persistence, checkpoint versions,
execution segments, retry identity and completion. Failed persistence leaves the
accepted in-memory state unchanged and later saves can retry. Legacy task records
upgrade additively; unreadable checkpoint files fail explicitly at startup.
Running tasks become waiting after restart. `server/bridge.ts` handles routing and
authorization; shared task types, connection and CLI carry snapshots and bounded
views. `src/app/task.ts` shows progress, errors, durable effects, before/after
review and conflict-aware undo. Pending context from an earlier segment cannot
unlock resumed editing. Only explicit open/create/import changes task song binding.

PLAN Phase 7 is expanded; PHASES links its detailed entry; CONTEXT adds musical
writing vocabulary. README, capability map, agent tool documentation, evaluation
record and portable example describe delivered behavior. No dependencies added;
there is no phase registry in this project. Phases 8–9 remain unimplemented.

## Validation

| Command | Result |
| --- | --- |
| `bun install --frozen-lockfile` | PASS; unchanged dependencies |
| `bun run verify` | PASS; strict TypeScript, 81 tests, production build |
| `bun run test:browser tests/browser/workflows.spec.ts` | PASS; both new workflows, including HTTP status assertions |
| `bun run test:browser` | PASS; all 26 Chromium workflows on the final implementation |
| `git diff --check` | PASS |

Eight new task-store tests cover disk failure/serialized retry, restart/resume,
checkpoint conflict, unfinished-item/outstanding-call completion rejection, step
identity/result preservation, call/time limits, payload-free status/effect records,
legacy load/corrupt root and delayed old-context delivery. Two writing/context
checks cover schema-6 migration, portable import/undo, validation limits, summary
bounds, search totals, receipt detail and stale pagination. Full entity CRUD now
includes prompts; all earlier musical and media regressions remain intact.

Two new browser workflows exercise ordinary guidance/preferences/prompt editing,
recipe use, portable replacement, deletion, reload and foreign-edit draft conflicts;
and checkpointed agent work around another tab's title change, stale revision
rejection, fresh-context gating, work-item progress, durable change review and undo.
The existing lost-response test still verifies one durable operation after retry.

The live CLI initially caught a bridge response bug: successful queued steps
contain an empty `error` field, which a property-presence check misclassified as
HTTP 400. The queued reads still completed and were recovered by their step IDs.
The bridge now checks a nonempty error, and the browser helper explicitly asserts
HTTP success for successful responses. Focused and full final runs passed after
that correction. No tests were skipped or weakened.

## Live evaluation

Task `abd5d7ec-4331-49ed-8ca1-daacf4e948dc`, OpenAI / GPT-6 Codex (exact build
unavailable), used 13 tool calls over three execution segments, two checkpoint
versions and explicit waiting/completion. See
[record](agent-evaluation-phase7.json) and
[portable song/media/guidance](../examples/echoes-with-room.songbundle.json).

Browser setup imported the previous phase's synthetic media example and used the
ordinary guidance/prompt editor to save preservation instructions and a reusable
request. The live agent inspected state, previewed and created an independent
Reply section for the second appearance, and checkpointed partial work. A scripted
second browser tab then renamed the song through its ordinary title editor and
clicked Resume. The agent claimed the task, refreshed live revision 5, inspected
the earlier durable receipt, and rotated only the copied guitar attacks by 1/3
quarter. It compared patterns, inspected tablature/recorded anchors and exported
a complete bundle before completing all three work items.

Independent Python fraction/equality/SHA-256 checks verified the writer title,
original events/chords/patterns/voices/placements/fingerings/settings/assets/takes,
exact rotated copied attacks with unchanged pitch/releases/expression, byte-identical
audio, take anchors 1/3 and 25/3 with unchanged trims, and portable writing guidance.
Fifteen checks passed. Tablature reported zero issues, stale entries or unplaced
notes. The rendered editor, task progress and changes were visually inspected.

The browser setup/intervention and fault tests are scripted; the musical decisions
and primitive composition came from the live agent. This is not a claim of an
unattended hosted model service, physical microphone test or human listening test.
The initial response-status repair accounts for the extra preflight segment.

## Limits and remaining uncertainty

Each segment allows 100 calls / 15 minutes; each task allows 1,000 calls. Limits
retain pending work and require explicit resume. Task status shows the most recent
20 tasks and ten steps per task; CLI pages inspect older records. Default musical
context pages contain 20 entries, at most 50, with clipped summary labels; use
explicit reads for full content. Continuation callers should supply the returned
song/revision to detect intervening edits. Full read/step/bundle payloads can still
be large and are deliberately requested separately.

Guidance limits: 8,000 instruction characters, 4,000 preference characters, 32
prompts of 8,000 characters each. Guidance is per project and portable between
songs, not an account-wide profile. Imported content does not override the current
request or tool authority. Tasks retain their original guidance snapshot.

The external coding-agent host supplies reasoning, context consolidation and
model token/cost controls. The local bridge stores progress, not model credentials
in music. Browser reload preserves client identity; closing a tab and adopting its
task from an unrelated new tab still requires reconnecting its saved client ID.
Already executing tools can finish after cancellation. Mobile background execution,
remote sync and automatic task takeover remain later work. A host restart is tested
in the task store; the live evaluation exercised checkpoint/resume with actual
browser collaboration, not a long-duration mobile deployment.
