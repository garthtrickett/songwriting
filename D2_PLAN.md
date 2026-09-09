# D2 — Rust musical workspace and migration

Proposed, awaiting explicit activation. D1 remains the active phase; no D2
implementation starts until it is selected. This plan exists because each phase
gets detailed implementation tasks before it starts.

## Outcome

The complete existing musical model, commands, acceptance rules, history,
analysis and derived editor/agent representations move into the Rust SAM core.
The desktop editor and Rig tools use the same Rust actions; the TypeScript
domain implementation is removed from the desktop runtime (it stays as the
browser reference and differential oracle). Browser-to-desktop round trips
preserve music, and profiles can be created, switched and fenced.

## Starting inventory (2026-09-09)

- Rust accepts 3 actions (`rename`, `moveNote`, `undo`) against a restricted
  schema-7 fixture subset. Rejections, revisions, receipts and undo are proven.
- TypeScript commands span 7 kinds (`harmony`, `edit`, `replace`, `delete`,
  `rhythm`, `structure`, `undo`) over ~17 domain modules: arrangement,
  chord-builder, fretted/tablature, harmony (+pitch/analysis), history,
  migrate, model, note-edit, rhythm (+analysis), structure, time, timeline,
  validate, voice-leading.
- `workspace.sqlite` is at `user_version` 2 with song envelope, revision,
  history, receipts and the agent task ledger. One default profile; no
  create/switch/fencing. Browser persistence (IndexedDB) and `.song.json`
  export/import live only in TypeScript.
- Generated `ts-rs` contracts already carry every Rust action/state shape to
  Lit; the desktop view adapter pattern is proven for the D1 slice.

## Cutover sequence

Work in slice order; each slice lands only with its parity evidence. Never
route an unsupported desktop action to a second TypeScript model.

1. **Time and validation.** Port exact rational time, timeline arithmetic and
   the validator. Differential fixtures against `src/song/time.ts`,
   `timeline.ts` and `validate.ts`, including tuplet positions and the D1
   boundary cases. No UI change.
2. **Model, history and deltas.** Port the document model, change application,
   delta derivation and history/undo semantics. Replay recorded browser
   command sequences and compare resulting documents, rejections and undo
   stacks entry by entry.
3. **Command families.** Port `structure`, `rhythm` (+analysis),
   `harmony` (+pitch/analysis), `note-edit`/`edit`, fretted/tablature and
   arrangement placement in that order — structural before expressive. Each
   family gets fixture comparisons for accept, reject and conflict paths.
   `replace`/`delete`/`migrate` arrive with persistence below, not as model
   shortcuts: no prevalidated song replacements bypass acceptors.
4. **Derived representations and analysis.** Port state projections, rhythm
   results, harmony results, voice-leading and tablature derivations used by
   the editors and agent context. Compare against TypeScript outputs on the
   shared fixture corpus, including the Phase 1–7 musical fixtures.
5. **Persistence and migration.** Versioned song envelopes as JSON plus indexed
   identity/revision fields, operation receipts, backups and migration
   archives. Browser `.song.json` and IndexedDB import paths become validated
   Rust actions; duplicate imports, failed migrations, read-only/full disks
   and corrupt envelopes are tested. Preserve schema-7 semantics; envelope
   and archive versions evolve independently with explicit migrations.
6. **Profiles.** Create/switch with the D1 lifecycle contract: stop
   transport/capture safely, checkpoint agent work, close stores, clear
   credentials from memory, advance the execution epoch and reject late
   messages from the old epoch. Stale-profile processes and profile fencing
   are tested, including two hosts on one profile.
7. **Rewire and remove.** Rewire every desktop editor action to Rust through
   the existing command interface, regenerate contracts, then delete the
   TypeScript domain implementation from the desktop runtime. The browser
   build keeps it as the reference. Any action that cannot yet cut over stays
   visibly unavailable.

## Interface rules

- `deny_unknown_fields` on every Rust action/command envelope, as today.
- The external interface keeps accepting scoped intents, never arbitrary
  memory patches, prevalidated replacements or SQL.
- Playback/capture workers close in D3/D4; only their document semantics and
  lifecycle interfaces are inventoried here, not their implementations.
- No new provider, credential or network surface: D2 works fully offline with
  no configured model. Credential storage belongs to D5.

## Exit evidence

- Command-sequence parity against TypeScript fixtures before each cutover,
  covering accepts, rejections, resulting documents, undo/conflicts and
  analysis outputs.
- Browser-to-desktop round trip of real songs (export → import → export),
  byte-comparable modulo declared migration bumps.
- Restart/restore, profile create/switch/fencing, failed-migration,
  read-only/full-disk, duplicate-import and stale-process tests.
- `bun run verify`, `bun run verify:desktop` and the full CI matrix green;
  results recorded in a `DESKTOP_D2_VALIDATION.md` alongside remaining gaps.

## Non-goals

D3 instrumental playback and device timing, D4 recording/media/take editing,
D5 agent catalog parity and BYOK UX, D6 responsiveness targets, D7 installers
and signing. Real-device, Safari and live-model evidence stay on their own
gates and are not claimed by parity fixtures.
