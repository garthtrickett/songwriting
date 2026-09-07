# Phase 4 validation

Date: 2026-09-07. Branch: `phase4`.

## Rationale and delivered scope

Schema 4 separates explicit song-relative notes from contextual interpretation.
Timed harmonic regions repeat with their sections; local context overrides global
context over half-open spans. Region changes never repitch notes. Chord labels
carry a relative `labelTonic`. Migration adds defaults to schema 1–3 documents,
history and deleted snapshots without changing timing or receipt fingerprints.

Five shared commands build chords, transpose patterns with copied chord
definitions, apply bounded octave voice leading, order member attacks, and shape
expression. The builder supports applied targets, explicit seventh qualities,
extensions, altered/added/omitted tones and retained-bass inversions. Notes remain
authoritative. Chord reassignment requires an explicit member-performance policy.
Voice-leading assignment minimizes total matched semitone motion within the
selected octave bounds and reports unmatched members. Performance gain and
articulation inherit or override event expression once.

Ordinary forms and agent tools use the same validated command path and preview
revision. Region/member drafts preserve typed work across incoming edits and
reject stale saves. Analysis offers finite-vocabulary exact pitch-class candidates
and actual audible notes by voice, including pedals, delayed attacks and releases.
Candidates are never applied automatically. Silent notes are excluded.

Files: `src/song/harmony*`, `chord-builder.ts` and `voice-leading.ts` own the
musical operations and queries; model, validation, migration, commands, section
variation and timeline integrate them. `src/app/harmony*`, annotations and
inspectors provide ordinary editing. `src/agent/` exposes recipes, commands,
queries and full CRUD. Tests cover model, storage/tool integration and Chromium.
PLAN.md holds the detailed phase, PHASES.md links to it, and CONTEXT.md defines the
new terms. README and capability/tool docs describe delivered behavior. No
runtime or development dependencies were added; no registry exists in this repo.

Notation references were checked against Open Music Theory's
[Roman numeral introduction](https://viva.pressbooks.pub/openmusictheory/chapter/roman-numerals/)
and [applied-chord discussion](https://openmusictheory.github.io/appliedChords.html).
The app uses explicit quality fields rather than assuming every seventh is the
same quality. It distinguishes half-diminished `ø7` and fully diminished `°7`.

## Automated evidence

| Command | Result |
| --- | --- |
| `bun install --frozen-lockfile` | PASS; no dependency changes |
| `bun test src/song/harmony.test.ts` | PASS; 13 musical-domain tests |
| `bun run verify` | PASS; strict TypeScript, all 53 unit/integration tests, production build |
| `bun run test:browser tests/browser/harmony.spec.ts` | PASS; all 3 new Chromium workflows |
| `bun run test:browser` | PASS; all 17 Chromium workflows |
| `git diff --check` | PASS |
| GitHub Actions | Pending publication; exact-head evidence will be recorded before closure |

Thirteen new model tests cover relative/applied/altered/suspended chord spelling,
omissions/inversions, half/fully diminished sevenths, contextual precedence and
repeats, build assignment and explicit performance reset, transposition isolation,
exact thirds and independent pedals, expression inheritance and silent notes,
bounded minimum motion with unequal chord sizes, ambiguity, affected shared uses,
undo/redo and actual schema-3 history migration. A new tool integration test checks
queries, preview/mutation parity, stale revisions, retry deduplication and undo.
The full entity CRUD audit includes harmonic regions. All prior tests remain.

The three new browser workflows use ordinary builder, context, transposition,
voice-leading, performance and expression controls, audio-graph output, import/
export/reload, undo/redo and conflicting tabs. Deliberate 100 ms save latency
ensures assertions wait for persistence. The first full run exposed a new field
label matching the older rhythm test's `Compare source` query. Renaming the new
fields to `Motion source chord` / `Motion target chord` resolved the ambiguity;
the focused affected workflows and final full suite passed. No old test was
removed or weakened.

## Live agent evidence

[agent-evaluation-phase4.json](agent-evaluation-phase4.json) records the exact
objective, exposed provider/model identity, all eighteen tool calls and explicit
completion. The primary Codex session performed the reasoning via the live Bun
bridge; persistent Chromium hosted the editor and submitted the objective. This
is separate from scripted transport/UI tests. One mutation omitted required
envelope fields and was rejected without changing state; the corrected request
succeeded. The evidence retains that failure rather than hiding it.

The agent authored [Moving centres](../examples/moving-centres.song.json):
7/8–9/8 in each of two sections, V9/V in the question, an independent answer
transposed down a perfect fifth, local V/mixolydian context and an unchanged low I
bass. Answer members attack at 0, 1/3, 2/3, 1 and 4/3 relative to each event, with
four-quarter durations. At quarter 9 the answer's first four members and the
independent bass sound; its ninth has not yet attacked. The complete answer has
an I9 candidate under local V. Inspecting it leaves the stored label unresolved
until the writer explicitly adopts an interpretation.

A separate Python `fractions.Fraction` calculation, direct relative-pitch
arithmetic and exported entity comparisons verified twelve preservation/timing/
context checks. Source notes, patterns, applied chord and bass placement remain
unchanged. The portable JSON is checked in. A full-page live-editor screenshot
was inspected for workbench and context/timeline layout.

## Limits and remaining uncertainty

- Candidate interpretation uses a finite exact pitch-class vocabulary and actual
  note roots. It does not infer function, cadences or missing roots. Arbitrary
  explicit note collections/custom labels remain valid.
- Voice leading supports 1–8 members and a 0–2 octave radius. Its objective is
  minimum matched semitone motion, not stylistic counterpoint or fingering.
  Unmatched members are explicit; shared target chords change in all their uses.
- Context is annotation; notes always use song-relative coordinates. Changing a
  context alone can leave an existing label referring to an earlier labelTonic.
  Transposition clears copied labels; adoption is an explicit edit.
- Expression selection is within one pattern. Member gain/articulation overrides
  remain attached to member IDs. Duration and attack edits use exact quarter units.
- Browser tests verify actual audio-graph output; no subjective listening or
  physical-device testing is claimed. The live run is one acceptance example,
  not a broad model benchmark. Drafts remain transient until saved.
- No guitar fingering, recording, engraving, remote sync or hosted reasoning was
  added. Those phases remain planned. Large analysis/expansion requests reject
  at documented bounds instead of silently truncating music.
