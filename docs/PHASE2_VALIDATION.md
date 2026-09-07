# Phase 2 validation

Date: 2026-09-07. Branch: `phase2`.

## Implementation rationale

Schema 2 distinguishes section-relative placements from global placements.
Arranged appearances expand local music, phrases and lyrics at derived exact
positions. Existing schema 1 songs migrate as global music; no ownership is
inferred. Stored history values upgrade alongside songs, preserving revision and
operation fingerprints so old retries and undo still work.

Structural commands produce atomic entity changes through the existing command
path. Independent variations copy their local patterns, events, chords, bars,
phrases and lyrics while preserving internal references. UI and agents use the
same commands and preview queries. A preview captures a revision. Lyric drafts
retain their original revision and text through incoming edits.

## Evidence

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile` | PASS, no dependency changes |
| `bun run verify` | PASS: strict TypeScript, 27 unit/integration tests, production build |
| `bun run test:browser` | PASS: all eleven Chromium workflows |
| `git diff --check` | PASS |
| Live external-agent composition | PASS: 13 calls through the live browser bridge |
| GitHub Actions | Pending publication |

Unit/integration checks cover actual section reuse, variation isolation,
per-member chord releases, exact meter shifts, phrase/lyric containment,
reference rejection, lineage cycles, global preservation, migration of a
pre-existing database/history, durable retries, undo/redo and agent parity.

Browser checks include the five Phase 1 workflows plus four Phase 2 workflows:
manual A–B–A′ arrangement/lyric/entrance edits and reload/export; keyboard
focus/nudging/undo/redo/zoom; stale previews and unsaved lyric drafts during
incoming agent edits; fresh section/bar/phrase/lyric creation without JSON.
The initial full browser run passed eight workflows. The ninth read before a
save completed; it now waits for the persisted musical result and passes in a
focused run. That local full suite passed all nine workflows. GitHub then exposed two real
races: a background render reset an in-progress title, and consecutive inspector
edits captured the same revision. Both now have deterministic reproductions.
The fix preserves DOM text on unchanged renders and composes queued local field
intentions only across that queue's accepted operations. Foreign mutations still
cause revision conflicts. A new integration check proves that distinction.

The two new browser regressions and both previously failing workflows pass in a
focused run. The expanded full suite also passed all eleven workflows.

## Real-agent evaluation

See [agent-evaluation-phase2.json](agent-evaluation-phase2.json). Reasoning used
the primary Codex session through `scripts/agent.ts`, the Bun loopback bridge,
and a persistent Chromium editor. The browser harness only hosted the editor;
it did not perform reasoning. Schema 2/tool version `phase2-structure-v1` and the
exact objective are recorded; the exact model build was not exposed.

The live agent created *Turning rooms*, previewed and repeated A, moved its
return after B, made A′ independent, and changed only its lyric and guitar
entrance. Live range reads verified section starts at 0, 8 and 13 quarter notes,
the guitar return at 27/2, and the global bass release at 21. Export comparison
verified every original entity unchanged. The task explicitly signalled completion.
The resulting [editable example](../examples/turning-rooms.song.json) is the
welcome screen's example; Countercurrent remains available in `examples/`.

## Scope and limitations

Global placements retain their start/span; their explicit continue/restart/stop
choices still respond to section boundaries. Local placements repeat from their
stored phase on every appearance. Ongoing cycles across sections remain global.
Meter edits preserve local offsets and reject overflowing spans instead of
stretching/cropping. Removing an appearance keeps reusable definitions.

Lyrics are plain multiline text, with section-local spans and optional phrase
and part links. They are not sung audio or syllable-level notation. Drafts survive
incoming edits in the open editor but are not durable until Save lyrics succeeds.
A section variation copies local music; it does not copy unrelated global music.
Reusing/deleting interdependent definitions may still require atomic edits.

No new dependencies, hosted model service, remote sync, recording, tablature,
advanced rhythmic transformations or harmonic inference were added. Tests target
Chromium on Linux; physical-device ergonomics and subjective audio listening
remain unverified. Browser audio checks continue to exercise the actual graph.
