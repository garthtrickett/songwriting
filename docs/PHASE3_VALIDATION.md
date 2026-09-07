# Phase 3 validation

Date: 2026-09-07. Branch: `phase3`.

## Rationale and delivered scope

Schema 3 adds independent pattern groups, stable event origins, and explicit
polyrhythm declarations. Groups use exact quarter-note durations rather than
borrowing a bar's written meter. Declarations record intended divisions; their
query reports actual base attacks and missing/extra pulses after edits. They do
not silently quantize notes. Schema 1/2 migration adds defaults to songs and
history values while preserving operation fingerprints and existing timing.

Eight rhythm commands produce validated atomic entity edits: independent pattern
variation, displacement, phase shift, attack rotation, accent rotation, scaling,
splicing, and polyrhythm generation. Release and phase policies are explicit.
Variations copy referenced chords while preserving event origins. Section
variations also copy their declarations and relink the copied placements.

UI forms and tools share those commands. Revision-bound previews expose entity
changes and affected placements; undo/redo uses the existing durable receipts.
The workbench compares A/A′ on a shared time scale and maps cycle intersections.
Grid scope and lane references save together as a draft, because separately saving
one can break the other. Incoming changes preserve drafts and reject stale saves.

Files: `src/song/` owns model, migration, validation, commands and analysis;
`src/app/rhythm*` and `polyrhythm.ts` own the workbench and grid drafts;
`src/agent/` exposes discovery and queries. Existing inspectors and section
variation code integrate the new entities. PLAN.md contains the detailed phase;
PHASES.md links to it. CONTEXT.md and the capability/tool docs cover the vocabulary
and shared outcomes. No dependencies were added.

## Automated evidence

| Command | Result |
| --- | --- |
| `bun install --frozen-lockfile` | PASS; no dependency changes |
| `bun run verify` | PASS; strict TypeScript, 39 unit/integration tests, production build |
| `bun run test:browser tests/browser/rhythm.spec.ts` | PASS; all 3 new Chromium workflows |
| `bun run test:browser` | PASS; all 14 Chromium workflows |
| `git diff --check` | PASS |
| GitHub Actions | Pending publication and exact-commit verification |

The eleven new model checks cover exact 3:2 and 5:4, inverse scaling and fixed
releases, negative wrapping, rest-preserving accent rotation, splice grouping
boundaries, later chord-member attacks, explicit event deletion, phase policies,
source/chord isolation, comparisons, local repeats, bounded/no alignment results,
section declaration copies, validation, migration and undo/redo. A new tool
integration check covers previews, stale revisions, retry deduplication, grid and
comparison queries, and undo/redo. The complete entity CRUD audit now includes
polyrhythms. Legacy database tests remove new fields to exercise actual migration.

The three new browser workflows exercise ordinary forms for every transform,
source comparison, undo/redo, polyrhythm generation and grid/group inspection,
actual audio-graph output, export/import/reload, alignment marking and a stale
preview during an edit from another tab. Existing eleven workflows remain.
The first full run passed twelve workflows; two new tests queried the app before
reload initialization finished. Explicit app-readiness waits corrected the tests;
the focused run then passed all three. The final full run passed all fourteen.
No application check was skipped.

## Live agent evidence

[agent-evaluation-phase3.json](agent-evaluation-phase3.json) records the exact
objective, exposed model identity and sixteen calls through the live bridge.
The primary Codex session performed the reasoning; persistent Chromium hosted
the editor and submitted the objective. This is separate from scripted browser
transport and UI tests. The task explicitly reached `completed`.

The agent authored [Crossing lines](../examples/crossing-lines.song.json):
alternating 7/8 and 9/8 bars, a held global bass, a 3:2 guitar/drum grid over four
quarters, and an independent three-pulse reply compressed by 2/3. The source
attacks are 0, 4/3, 8/3; the reply's are 0, 8/9, 16/9. Durations remain 1/4.
Both declared lanes match their grids; source and reply cycles meet again at 8.

A separate Python `fractions.Fraction` calculation and exported entity comparison
verified exact attacks, cycle intersection, distinct voices, unchanged source
patterns/events, and unchanged bass. Original pulse placements were deliberately
extended to repeat over sixteen quarters. The exported result is editable JSON.
A full-page screenshot was visually inspected for workbench and timeline layout.

## Limits and remaining uncertainty

- Origins are assigned from event IDs during migration; older variations have no
  inferred ancestry. They may compare as added/removed events.
- Grid analysis compares base attacks, excluding rests and chord-member offsets.
  Removing a declaration keeps its music. Deleting linked music requires adjusting
  references atomically. Scope and lane edits use **Save grid**.
- Alignment output is capped at 512 points per lane/intersection with explicit
  totals/truncation; expansion above 100,000 cycle points rejects rather than
  allocating unbounded output. Very dense or long arrangements remain bounded.
- The basic audio engine is unchanged. Automated tests verify audio-graph output;
  there is no claim of subjective listening or physical-device testing.
- One live reasoning session is an acceptance example, not a broad model benchmark.
  Drafts remain transient until saved. No recording, harmony inference, guitar
  fingering, remote sync, or hosted reasoning service was added.
