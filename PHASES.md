# Songwriting app — implementation phases

Status: Phases 1–7 are complete. Phases 8–9 remain planned. Evidence: [Phase 1](docs/PHASE1_VALIDATION.md), [Phase 2](docs/PHASE2_VALIDATION.md), [Phase 3](docs/PHASE3_VALIDATION.md), [Phase 4](docs/PHASE4_VALIDATION.md), [Phase 5](docs/PHASE5_VALIDATION.md), [Phase 6](docs/PHASE6_VALIDATION.md), [Phase 7](docs/PHASE7_VALIDATION.md).

[PLAN.md](PLAN.md) defines the product and technical requirements.
[CONTEXT.md](CONTEXT.md) defines the musical vocabulary. This document sequences
delivery; it does not replace either reference.

Phases 1 and 2 are expanded into implementation detail. Phases 3–7 are detailed in PLAN.md; Phases 8–9 remain high-level until selected. Each detailed phase replaces its high-level entry.

## Delivery rules

- Deliver the first useful math-rock composition in Phase 1, including actual
  agent operation. Agent parity, exact timing, and durable song ownership are
  foundations, not integrations to add after building the editor.
- Every phase extends the shared UI/tool editing interface, capability map,
  validation, persistence, and undo for the features it introduces.
- Keep notes relative to the tonal centre, chords as collections of notes, and
  musical structure independent of instrument sound and playback key.
- Later phases may enrich the document format through explicit migrations.
  Do not implement speculative fields and empty modules for every future feature.
- A phase closes on demonstrated musical outcomes and passing checks, not just
  compilation or an agent's report of success.

## Phase 1 — A playable, persistent, agent-native math-rock sketch

**Status:** DONE — local checks, live-agent evaluation, and GitHub verification passed

### Outcome

A writer can create a short song in the browser, combine independently repeating
guitar and drum patterns with a sustained bass part, make a variation, and hear
the result. They can perform the same edits directly or through an agent. The
song remains editable after reload and JSON export/import, and neither agent
activity nor a stale save can overwrite intervening user edits.

This is a small complete writing workflow. Use a functional editor and simple
sounds; comprehensive notation, production audio, and advanced guitar fingering
are later phases.

### 1.1 Establish the project and executable checks

- Scaffold Bun, Vite, strict TypeScript, standalone `lit-html`, and the test
  setup described in the plan. Copy the useful `Result` helpers and conventions
  from notes into this project without runtime imports from that repository.
- Pin the Bun version, commit the lockfile, and provide `dev`, `check`, `test`,
  `build`, and `verify` scripts. `verify` runs typecheck, tests, and build.
- Add CI using the pinned runtime and frozen-lockfile installation.
- Choose a real-browser test tool for playback, IndexedDB, multiple tabs, and
  agent/UI integration. Record its command in the project instructions.
- Choose and document a minimal agent provider, execution host, and connection
  into the open app. Implement this choice during Phase 1; a mock tool caller
  alone is not the agent-native milestone. Keep credentials on the chosen host,
  outside browser bundles and exported songs.
- Make the manual app start and function when the agent connection is absent.

### 1.2 Implement the musical document and exact timeline

Define the smallest versioned song document that can express the milestone:

| Concept | Phase 1 requirements |
| --- | --- |
| Song | Stable ID, title, schema version, relative tonal context; saved revision tracked by the workspace |
| Section and occurrence | Named passages and their arrangement; references distinguish a section from each appearance |
| Part and voice | Guitar, bass, and drums as parts; independently timed voices within a part |
| Pattern | Stable ID, events in relative time, cycle duration independent of bars |
| Pattern occurrence | Part/voice placement, start, repeat span, phase offset, and explicit continuation/restart/stop behaviour |
| Note | Degree, alteration, and relative octave using the major-scale reference |
| Chord | Nonempty collection of identifiable notes and an optional intended Roman-numeral interpretation |
| Performance | Timed note attacks/releases associated with chord members when needed; simultaneous playback is the default |
| Event | Exact position/duration for notes, chords, drum hits, or voice-scoped rests; basic accents and sustain |
| Meter | Per-bar signature and grouping, inherited where appropriate; actual duration for incomplete bars |
| Tempo | BPM and an explicit beat unit, independent of the timeline's quarter-note storage unit |
| Annotation | Named point or span, sufficient to mark cycle alignments and structural boundaries |

Use normalized integer fractions of quarter notes for positions and durations.
Define validation for finite integers, positive denominators, valid durations,
and arithmetic bounds; reject invalid values rather than introducing rounding.
Preserve the written time signature rather than reducing it like a fraction.

The timeline must resolve mixed meters, groupings, pickup bars, and exact tuplet
positions. Resolve pattern occurrences against this shared timeline without
restarting them at bar lines. Calculate alignments for the selected patterns and
bounded time range, including phase offsets; return no alignment when applicable.

Write down concrete rules before implementing structural edits:

- How changing a bar's length affects following bars and existing events.
- Whether a repeated pattern's last note is allowed to ring past a cycle or
  occurrence boundary, and how an explicit stop releases it.
- How an occurrence continues across arranged sections without duplicate notes.
- How deleting a referenced object is rejected or accompanied by explicit
  reference changes in the same atomic edit.
- How a chord-member edit affects its own performance while preserving
  independently written notes elsewhere.

Each rule must produce an explicit, undoable result without silently losing
notes. Keep core timeline and musical transformations independent of browser,
storage, audio, and model-provider APIs.

### 1.3 Build one editing interface for people and agents

Implement commands and queries used by both UI handlers and agent tools, with
the SAM loop owning accepted model transitions. Separate external commands from
internal persistence/audio completion proposals.

Provide primitives to inspect the workspace and selection, read music by ID or
time range, and create/read/update/delete every editable Phase 1 entity. Include
placing occurrences, creating variations, editing chord members and individual
notes, querying alignment, adding markers, and undo/redo. Provide a general
validated document-edit operation for combinations without a shortcut.

Every mutation carries its expected revision and a stable operation ID. Return
the accepted revision and affected IDs or an actionable rejection. Multi-object
edits can commit atomically. Domain tools may validate and calculate, but must
not encode the agent's musical decisions in a fixed rewrite workflow.

Maintain a capability map connecting every implemented UI outcome to tool
primitives. Missing update/delete operations or tool-only mutations that the
editor cannot display prevent completion.

### 1.4 Deliver the minimal composition editor

- Provide song creation/opening and a section-based timeline showing the current
  bars, meter, pattern boundaries, part/voice lanes, notes, chords, and rests.
- Provide selection and clear controls for entering and editing relative pitch,
  exact timing, chord membership, accents, pattern duration, and occurrences.
  Numeric inspectors are sufficient before more elaborate gesture editing.
- Allow the writer to place and repeat patterns, make an independent variation,
  edit a section boundary's continuation choices, and mark an alignment point.
- Show Roman numerals when assigned and the actual contained notes. Preserve
  unlabelled or unresolved harmonies instead of forcing a classification.
- Show selected objects and shared-pattern impact so edits do not accidentally
  change unrelated material. Make undo/redo available for manual and agent edits.
- Display saved/pending/error state and incoming agent changes. Keyboard focus
  and dialogs must not cause composition shortcuts to fire in text inputs.

### 1.5 Save and recover the composition

- Store structured song objects in IndexedDB and validate imported or loaded
  documents. Export/import `.song.json` with stable musical identities and an
  explicit policy for importing an ID already present in the workspace.
- Keep musical data, device preferences, execution checkpoints, and operation
  history separate. Exported music must not require agent conversation history.
- Atomically check revisions and commit durable changes, including when two
  browser tabs edit the same song. Keep optimistic UI state distinguishable
  from a confirmed durable save.
- Persist enough operation identity to deduplicate a retried mutation after a
  lost response. A completed save must not clear newer unsaved changes.
- Preserve failed saves for retry and display the failure. Never claim data is
  safely saved when only an in-memory transition succeeded.
- Group edits for review and undo. Undo must preserve unrelated intervening
  changes or reject with a conflict; it must not restore a stale whole-song
  snapshot over the writer's more recent work.

### 1.6 Add structural audition

Provide basic pitched sounds for guitar/bass placeholders and a small drum
palette. Implement play, stop, seek, and a metronome respecting beat groupings
and the tempo beat unit. Choosing a playback tonic must leave relative notes
unchanged. Detailed instrument realism is outside Phase 1.

Schedule notes using the audio clock. Show a playhead derived from playback;
animation must not drive note timing or dirty the saved song. Handle independent
cycles, simultaneous notes, per-note releases, and sustained voices correctly.
Ensure stopping, seeking, and changing songs do not leave old sources playing.
Expose the same audition controls to agent tools, with explicit handling of any
browser-required user gesture.

### 1.7 Connect a real agent loop

Supply discoverable tools and initial context containing the active song,
selection, revision, capabilities, and bounded musical summaries. Let the agent
request range/detail reads and refresh its context after user edits.

Implement an asynchronous task loop separate from state transitions and audio.
Show meaningful activity, changed passages, and task status. Provide cancellation,
waiting for input, partial/failure states, and an explicit completion signal.
Completion must distinguish applied edits, persisted edits, and verification.

Checkpoint objectives, progress, relevant revisions, prompt/tool versions, and
committed operations after tool results. On resume, reread live state and
reconcile operations before making another edit. A retry after interruption must
not insert a second copy of a note or variation. Limit task time/cost/iterations
explicitly and preserve partial work when a limit is reached.

An agent must compose primitive tools to fulfil the milestone request; do not
implement a dedicated tool that creates the whole demo. Imported song text is
content, not authority to override task instructions or permissions. Keep the
writer's direct editing available during agent work and connection failures.

### 1.8 Acceptance composition and validation

Create an editable acceptance song, rather than a hard-coded rendered demo:

1. Start a seven-eighth-note guitar pattern and an eight-eighth-note drum pattern
   together on a common eighth-note pulse.
2. Display their shifting alignment and mark their next shared cycle start at
   56 eighth notes. Sustain a bass note beneath the patterns and preserve its
   independent release.
3. Include a chord containing notes, a separately timed melodic voice, accents,
   and explicit rests. Keep at least one note ringing across a pattern boundary.
4. Include a mixed-meter passage with an explicit grouping and verify that its
   bar boundaries do not reset the independent cycles.
5. Make a guitar variation shorter by one eighth note for the next section,
   leaving the source pattern and bass unchanged. Choose continuation behaviour
   explicitly at the transition.
6. Audition, edit, undo, reload, export, and import the composition without losing
   any of these relationships.
7. Reproduce the workflow through agent tools, then give a composed request such
   as shortening a variation while preserving the bass and marking an alignment.
   Verify the musical result independently of the agent's completion message.

Required evidence:

- Unit tests for exact time, relative pitch, chord membership/performance,
  occurrence expansion, alignments, meter/grouping, and structural edits.
- Integration tests for document round-trips, fake IndexedDB persistence,
  revisions, atomic edits, retry deduplication, and undo conflicts.
- Equivalent UI-command and agent-tool tests plus a complete Phase 1 capability
  map. Test multi-step compositions, not only individual tool invocation.
- Browser checks for editor interaction, durable reload, two-tab conflicts,
  scheduling, overlapping releases, and explicit stopping. Inspect scheduled
  events and audible output; DOM tests cannot prove audio correctness.
- Agent recovery checks covering an edit committed before its response is lost,
  a user edit arriving mid-task, cancellation, and reload/resume.
- At least one real-model end-to-end run of the acceptance request, recording
  provider/model and prompt versions and checking preservation constraints.
- `bun install --frozen-lockfile`, `bun run verify`, the documented browser
  and agent evaluation commands, and `git diff --check` pass. CI runs the
  applicable automated checks for the delivered commit; record any environment
  limitations explicitly rather than counting an unrun check as passing.

### Exit gate

Phase 1 is complete when the acceptance composition can be authored manually
and by a real agent, auditioned, safely edited alongside agent activity, and
recovered from storage and export. All Phase 1 UI outcomes have tool parity,
the required checks pass, and known limitations match the exclusions below.

### Scope boundary

Do not include full harmonic inference, a general notation engraver, advanced
riff-comparison views, alternate-tuning tablature, recording/media bundles,
remote song sync, or polished instrument modelling. Later phases own these.
Do not use these exclusions to defer relative notes, complex meter support,
independent patterns, basic per-note timing, real agent access, durable saves,
undo, or the milestone's simple playback.

## Phase 2 — Fluent song structure and arrangement editing

**Status:** DONE — local checks, live-agent evaluation, and GitHub verification passed

### Outcome

Arrange a complete A–B–A′ song through ordinary controls or shared agent tools.
Repeating or moving a section carries its music, phrases, and lyrics. A variation
can change an entrance or lyric without altering its source. The writer can see
shared edit impact, navigate the song map, and undo or redo structural changes.

### 2.1 Define section ownership and migrate existing songs

- Introduce schema 2 with phrases, lyric spans, section variation lineage, and
  an explicit section reference on pattern occurrences.
- A section-relative occurrence uses start/span in quarter notes from the section
  beginning and plays on each arranged appearance. Global occurrences use song
  time and can continue across sections; show that distinction in the editor.
- Preserve every Phase 1 occurrence as global on migration. Do not infer ownership
  or split notes at boundaries. Upgrade imports and stored songs, including undo
  history values, without changing revisions or durable retry identities.
- A local placement's attacks/repetition span must fit its section. Independent
  note releases may ring beyond it according to the existing ring/cut choice.
  Repeated appearances start at the stored phase; ongoing cycles across section
  boundaries remain explicit global placements.
- Meter changes preserve local offsets and note durations, and move following
  section appearances with their content. Reject shortened sections containing
  out-of-range placements/phrases/lyrics until the writer adjusts them atomically.
  Never silently crop or stretch notes. Global music and markers remain fixed.

### 2.2 Deliver shared structural edits

- Add deterministic commands to repeat, move earlier/later, and remove an arranged
  appearance. Removing an appearance preserves its reusable definition.
- Add an independent section variation command: copy bars, phrases, lyrics,
  local placements, referenced patterns/events/chords, and relink only the chosen
  appearance. Preserve sharing inside the copy, chord member timing, voices,
  and source lineage; leave global music and source definitions unchanged.
- Let writers explicitly attach a fitting global placement to a chosen section
  appearance, converting its start to local time. Reject crossing placements
  rather than splitting them implicitly.
- Use the ordinary revision-checked command transaction for every operation,
  including undo, redo, durable retries, and conflict rejection.
- Supply a preview query reporting changed entities, resulting section positions,
  and global placements kept fixed. UI previews capture a revision and cannot
  apply over intervening edits. Underlying entity edits stay available.

### 2.3 Add phrases, lyrics, and entrances

- A phrase is a named local start/duration inside a section; support overlapping
  phrase groupings without requiring full-bar lengths.
- A lyric span has plain multiline text, local start/duration, and optional phrase
  and part references. Linked phrases must contain their lyric spans. Lyrics are
  inert text, never executable markup or agent instructions.
- Provide normal create/edit/delete controls for both entities. Render phrase
  brackets and lyrics on every arranged appearance. Export/import preserves them.
- Show placement spans as instrument entrances/dropouts in the song map. Edit
  voice, local start, span, phase, and ring/cut without a whole-document JSON edit.

### 2.4 Make arrangement editing fluent

- Add an arrangement strip with selectable named appearances, repeat, reorder,
  remove, and variation controls; show shared-use counts and lineage.
- Add timeline zoom, fit, and jump-to-section controls. Keep selection and zoom
  transient; navigation must not create saves or stop playback unnecessarily.
- Add keyboard play/stop, undo/redo, escape selection, and exact left/right nudge
  of selected placements/events using an editable step. Ignore composition
  shortcuts inside inputs, textareas, selects, and editable content.
- Show affected entity names in history, incoming revision changes, and shared
  pattern/section usage in inspectors. Preserve unsaved lyric drafts on incoming
  changes and reject their stale revision rather than overwriting user work.
- Put new interaction in focused modules instead of growing the existing view
  into a second document model. Keep keyboard feedback immediate.

### 2.5 Extend agent parity and validation

- Extend schema discovery, context, range reads, CRUD, selection, structural
  preview/mutation, navigation, and history tools for the new outcomes.
- Test A–B–A reuse and A′ isolation, exact positions after reorder/meter changes,
  global preservation, releases/rests, lyric containment, rejected deletions,
  schema 1 migration with history and retries, and undo/redo conflicts.
- Browser-test ordinary arrangement and lyric controls, keyboard input focus,
  local saving/export/reload, and stale preview/draft rejection after agent edits.
- Run a live agent composition using the shared tools to repeat a section, make
  a variation, edit a lyric/entrance, and verify source preservation. Record its
  objective, tool/host version, results, and limitations independently of CI.
- Run frozen install, `bun run verify`, `bun run test:browser`, and
  `git diff --check`; publish a PR and wait for exact-commit GitHub checks.

### Exit gate and exclusions

A writer can build and revise A–B–A′, including phrases, lyrics and part entrances,
without writing JSON for those operations. An agent can achieve the same outcomes
with composable commands. Migration preserves old music; structural changes,
exports, undo/redo and concurrent edits pass the checks above.

Do not implement Phase 3 rhythmic transformations, Phase 4 harmonic inference,
recording, tablature, remote sync, or a hosted model service in this phase.

## Phase 3 — Advanced rhythm and motif development

**Status:** DONE — local checks, live-agent evaluation and GitHub verification passed.
The detailed specification is in
[PLAN.md — Phase 3](PLAN.md#phase-3--advanced-rhythm-and-motif-development).
It covers explicit polyrhythm spans, pattern grouping, exact transformations,
A/A′ comparison, alignment visualization, shared commands and acceptance checks.

## Phase 4 — Harmonic writing and independent voices

**Status:** DONE — local checks, live-agent evaluation and GitHub verification passed.
Evidence: [Phase 4 validation](docs/PHASE4_VALIDATION.md).
Detailed specification: [PLAN.md — Phase 4](PLAN.md#phase-4--harmonic-writing-and-independent-voices).

## Phase 5 — Playable guitar and bass arrangements

**Status:** DONE — local checks, live agent evaluation and GitHub verification passed.
Evidence: [Phase 5 validation](docs/PHASE5_VALIDATION.md).
Detailed specification: [PLAN.md — Phase 5](PLAN.md#phase-5--playable-guitar-and-bass-arrangements).

## Phase 6 — Voice capture, media, and useful instrumental playback

**Status:** DONE — [validation](docs/PHASE6_VALIDATION.md). Detailed specification: [PLAN.md — Phase 6](PLAN.md#phase-6--voice-capture-media-and-useful-instrumental-playback).

## Phase 7 — Extended agent workflows and user customization

**Status:** DONE — [validation](docs/PHASE7_VALIDATION.md). Detailed specification: [PLAN.md — Phase 7](PLAN.md#phase-7--extended-agent-workflows-and-user-customization).

## Phase 8 — Reliable everyday use on desktop and phone

**Outcome:** Polish responsive interaction, accessibility, touch editing, and
PWA/offline behaviour. Exercise larger songs, cache/storage lifecycle, migrations,
exports, device interruptions, and agent reconnection in realistic use. Manual
composition remains available without agent reasoning; release evidence covers
supported browsers and actual devices.

## Phase 9 — Remote backup and cross-device continuity, if selected

**Outcome:** Decide whether local saving plus portable exports is sufficient.
If remote storage is selected, deliver explicit backup/sync ownership and
conflict handling for songs and assets, including stale agent sessions across
devices. Preserve one coherent editing history and the portable document format.
Provider choice and remote infrastructure remain an explicit product decision;
this optional phase does not block completion of the local writing app.
