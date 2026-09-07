# Phase 1 validation

Date: 2026-09-07. The standalone implementation is on branch `phase1`.

## Implementation rationale

The musical document and exact timeline are independent of the browser. UI and
agent tools share one command path; validated revision checks and operation
receipts commit in an IndexedDB transaction. An external coding agent reasons
through a local Bun bridge, while the browser remains the owner of song data.
The audio engine schedules independent note attacks/releases against its clock.

The editable sample `examples/countercurrent.song.json` was authored through
live agent primitives, not by a dedicated demo-generation tool.

## Local evidence

| Command / check | Result |
| --- | --- |
| `bun install --frozen-lockfile` | PASS: frozen lockfile installation |
| `bun run verify` | PASS: strict TypeScript, 16 unit/integration tests, production build |
| `bun run test:browser` | PASS: five Chromium workflows, including real audio-graph output |
| `git diff --check` / staged equivalent | PASS: staged whitespace check |
| Live external-agent composition | PASS: read, create, mutate, alignment, variation, export, transport, explicit completion |

Browser coverage includes manual inspector/document edits, export/reload,
conflicting tabs, lost bridge responses with delivery-cache removal, durable
operation deduplication, and deleted-song recovery. Unit/integration tests cover
exact tuplets, independent cycles, per-note chord performance, voice-scoped rests,
undo conflicts, and tool CRUD coverage across all Phase 1 entity tables.

The seven/eight cycles align at 28 quarter notes (56 eighth notes). Exported
before/after values independently verify that creating the shortened three-
quarter-note guitar variation preserved the source riff, original chord event,
and sustained bass event. The sample includes 7/8 and 9/8 bars, a 3/4 turn,
independent upper voice, accents, rests, and ringing notes.

## Real-agent evidence and limits

Provider: Codex, using the primary agent session performing this implementation.
The exact model build was not exposed; the evaluation record says so rather
than guessing. See `agent-evaluation.json` for the objective, tool steps, explicit
completion, and preserved operation IDs.

The local runtime was interrupted after revision 2. Restarting the bridge and
reconnecting the evaluation browser recovered the original song and task; the
agent reread context and completed the variation at revision 3. Automated
browser recovery testing separately drops a tool response and its delivery
cache, then verifies the edit is not committed twice after reload.

An external coding agent must claim the task; this is not an automatically
connected hosted chatbot. The browser harness keeps an editor open but does not
perform the model's reasoning. Model evaluations are recorded observations, not
a deterministic CI substitute.

Playback controls succeeded through the agent tools. Chromium tests measure
nonzero output from the actual audio graph and verify source cleanup. This does
not constitute a human listening review or validation on physical audio hardware.

## Publication

GitHub verified implementation commit `ab12fa9dc64a2ef268f7a8324fb0132aefbaded7`
on both push and pull request. Both runs completed successfully:

- [Pull-request run 34099513410](https://github.com/garthtrickett/songwriting/actions/runs/34099513410)
- [Push run 34099513246](https://github.com/garthtrickett/songwriting/actions/runs/34099513246)

The workflow runs frozen installation, `verify`, and all five browser workflows.
[PR #1](https://github.com/garthtrickett/songwriting/pull/1) contains the implementation
and these closure notes; its final commit must also pass verification before merge.

## Scope and remaining uncertainty

The phase delivers a functional structural editor with simple oscillator sounds.
Recording, media bundles, rich notation, advanced harmonic inference, alternate-
tuning fingerings, PWA installation, and remote song sync remain later phases.
Section ordering currently changes the meter map; moving independent patterns
is explicit. Some compound edits use the validated document inspector.

Tests currently target Chromium on Linux. Physical phone ergonomics, other
browsers, hardware latency, and subjective musical feel remain unverified.
Agent token/time budgets belong to the external host; the bridge enforces its
100-call limit. Reopening a task in a different browser tab requires explicitly
reconnecting its saved client identity; same-tab reload resumes automatically.
