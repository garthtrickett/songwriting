# Desktop D2 — Rust musical workspace and migration

Status: slices 1–7 implemented and merged (PRs #21–#29, #31–#34). The Rust SAM
core owns the full musical model, every command family, derivations, migration,
envelope import, profiles and the desktop command surface. The desktop window
renders generated contracts through thin transports with no TypeScript domain
dependency (enforced by `check-desktop-imports.ts` in `test:desktop`).

## Delivered slices

- **Time, timeline, validation (1a–1c):** exact rational arithmetic with floored
  cycle remainders, full timeline expansion, and table/lineage validation for
  every song table except binary-coupled media.
- **History (2):** undo/redo stack computation with per-step differential
  fixtures; redo surfaces in the desktop history panel.
- **Commands (3a–3d):** structure, rhythm (8 ops), harmony (5 ops plus pitch
  arithmetic, chord builder and voice leading), note edits and the generic edit
  path. Table deltas carry every non-event change; existing Title/Event
  receipts are untouched.
- **Analysis (4a–4c):** annotations, alignment maps, polyrhythm grids, pattern
  comparison, harmonic spans/context/interpretation/candidates, sounding
  harmony, fretted derivations, tablature and take placements.
- **Persistence (5):** schema migration (1–6 → 7), browser envelope import with
  replayed history including delete/restore tombstones, replace/delete actions
  with an optional-song lifecycle, idempotent imports and storage failure
  drills (corrupt envelopes, foreign/future databases, read-only dirs,
  contended commits).
- **Profiles (6):** fenced local profiles with create/list/switch, epoch
  advancement, bounded pre-switch backups, and audio/agent quiescence.
- **Desktop rewire (7):** redo button, profile switcher panel, and the import
  purity gate. The desktop bundle contains no `src/song` or `src/app` code.

## Differential evidence

Every slice lands with TypeScript-generated fixtures consumed by Rust tests:

| Fixture | Cases |
| --- | --- |
| commands / time / audio | 16 / 35 / 5 |
| timeline | 7 song variants |
| validate | 23 fault-isolated rejections |
| history | 16 command steps |
| structure / rhythm / harmony / edit | 11 / 20 / 18 / 17 |
| analysis | rhythm, harmony, fretted/tab/takes derivations |
| migrate / import | 12 migrations, replayed envelope with tombstones |

Local gates per slice: `bun run verify`, full pinned-decoder `verify:desktop`
(fmt, Clippy `-D warnings`, bindings check, workspace suite), and the
three-workflow CI matrix per pull request.

## Known parity boundaries

- Deep-copy id numbering follows sorted table order, not insertion order;
  variation is covered structurally rather than byte for byte.
- JSON has no float spelling: whole doubles compare numerically, never textually.
- Event tiebreaks use byte order; the reference uses locale order (agrees on
  fixture ids, can differ for mixed-case ids).
- Malformed wire values fail at Rust deserialization with serde messages
  rather than later validation messages; domain errors match exactly.
- Timeline density caps are enforced on expansion, not at command acceptance.

## Remaining gaps

D2 proves parity on fixtures, not devices: physical audio/microphone behavior,
Safari exports, live-model agent evaluation, trusted signing and per-target
installers stay open. D3 (instrumental playback), D4 (recording/media),
D5 (agent workflow), D6 (responsiveness) and D7 (ship) remain planned.
