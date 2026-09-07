# Phase 5 validation

Date: 2026-09-07. Branch: `phase5`.

## Implementation rationale

Schema 5 adds fretted arrangements and placement-specific fingerings alongside
relative music. Arrangement tonic and open strings use absolute MIDI pitches;
frets count above the capo. This permits alternate/re-entrant tunings and bass
without making positions authoritative. Musical links can become stale after
editing/deleting notes; diagnostics preserve the assignment for repair. Structural
shape, unique targets and arrangement ownership remain validated. Migration adds
empty tables to schemas 1–4 and their history without changing receipt identity.

Position search returns all compatible strings/frets. Timed tablature includes
exact member attacks and independent releases, diagnoses cross-voice string
collisions, connected-technique sources/direction and preferred hand span, and
shows stale/unassigned positions. A valid hammer-on/pull-off/slide consumes its
source's physical string interval without shortening the song's release. Section
variations copy local assignments and relink technique sources.

Ordinary forms, revision-bound previews and settings drafts share `edit`/`mutate`
with tools. The UI shows string 1 at the top, exact quarter positions, per-voice
release detail and issues. Arrangement and audition keys remain distinct.
[Source conventions](https://www.fender.com/articles/techniques/how-to-read-tabs)
and [connected techniques](https://www.fender.com/articles/techniques/master-hammer-ons-and-pull-offs)
were checked against Fender's teaching material; no prose was copied.

Files: `src/song/fretted.ts` / `tablature.ts` own calculations and diagnostics;
model, migration, validation, structure and timeline integrate them. New
`src/app/fretted*` modules provide settings/position/tab editing. Agent discovery,
queries, capability map and docs describe the shared interface. Model and browser
fixtures/tests cover behavior. No dependencies added and no registry exists.
Detailed scope: PLAN.md Phase 5; PHASES.md links to it; CONTEXT.md adds vocabulary.

## Validation

| Command | Result |
| --- | --- |
| `bun install --frozen-lockfile` | PASS; no changes |
| `bun run verify` | PASS; strict TypeScript, all 62 tests, production build |
| `bun run test:browser tests/browser/fretted.spec.ts` | PASS; both new workflows |
| `bun run test:browser` | PASS; all 19 Chromium workflows |
| `git diff --check` | PASS |
| GitHub Actions | Pending publication; exact-head evidence recorded before closure |

Eight new domain tests exercise standard/alternate/re-entrant tuning and bass,
capo arithmetic, no-position results, ringing cross-voice collisions, technique
direction and actual predecessors, transposition/deletion diagnostics, section
copies, schema-4 history migration/undo, uniqueness/shape checks, exact member
attacks, hand span and bounded display. The tool integration check covers queries,
preview/mutation parity, receipt retries and undo/redo. Full entity CRUD includes
both new tables; prior regressions remain intact.

Two new browser workflows exercise ordinary assignment/technique/tuning controls,
capo invalidation, undo, export/import/reload, and foreign edits while a tuning
draft and position preview exist. Deliberate 100 ms mutation latency retains
asynchronous persistence coverage. Strict type checking initially caught a
command-envelope mismatch and omitted type imports during integration; both were
fixed before tests. All final checks passed without weakening earlier tests.

## Live reasoning evidence

[agent-evaluation-phase5.json](agent-evaluation-phase5.json) records the exact
objective, exposed model identity, fifteen live tool calls and explicit completion.
The primary Codex session reasoned through the Bun/browser bridge; Chromium only
hosted the UI and submitted the request. This is distinct from browser scripts.

[Capo conversations](../examples/capo-conversations.song.json) uses 7/8 and 9/8,
DADGAD at capo 2 and tonic MIDI 50. The tapped melody uses string 2/fret 3, then
hammers to fret 5 at quarter 1/3; an independent low voice rings on string 5/fret 3
for eight quarters. Five realised attacks have no reported conflicts. Raising the
capo flags all three assignments; undo restores the original tuning. Nine
independent Python fraction, entity-preservation and MIDI/fret checks pass. The
portable example and evidence are committed; private task/browser files are not.
A full-page screenshot was visually inspected for tab and workbench layout.

## Limits and uncertainty

Tab diagnostics are constraints, not a proof of ergonomic playability or a hand
solver. Preferred span excludes open strings and tapping-hand positions. Physical
performance, subjective listening and device testing were not undertaken. The
live run is one acceptance example, not a broad benchmark.

Queries diagnose at most 5,000 realised notes with a two-million-comparison limit;
512 overlapping rows are displayed with explicit totals/truncation. Musical
expansion retains its existing bounds. Stale/unplaced positions need explicit
repair/deletion. Position assignments repeat with a placement; per-repeat
exceptions require independent placements/sections. Audition tonic retains its
existing MIDI 12–96 range, while realisation arithmetic supports 0–127.

Recording/media, extended agent customization and remote sync are outside this
phase. Phases 6 and 7 are authorized next after this merge.
