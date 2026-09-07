# Songwriting

A browser workspace for math-rock composition: relative notes and chords,
independent riff cycles, mixed meters, and an agent editing the same song you do.

## Run

Use Bun **1.4.2** (recorded in `.bun-version`).

```sh
bun install --frozen-lockfile
bun run dev
```

Open **http://127.0.0.1:5188**. In a second terminal, enable external agents:

```sh
bun run bridge
```

The editor saves songs to this browser's IndexedDB. Export copies you want to
keep independently of browser storage. Import `examples/countercurrent.song.json`
for a complete editable sketch authored through the live agent tools.

## Write a sketch

1. Start a song. Add a part, then a voice belonging to that part.
2. Add a pattern and set its cycle length. `7/2` quarter notes is seven eighths.
3. Add note, chord, rest, or drum events to that pattern. The inspector provides
   pitch degrees, timing, accents, and articulation. Add a chord before choosing
   it for a chord event; its contained notes are individually editable.
4. Add an occurrence to place a pattern in a voice. Choose its start, repeat
   span, phase, section-boundary behaviour, and whether the last notes ring out.
5. Add a section, its bars, and an arrangement occurrence. Bars provide the
   shared meter map. Changing their lengths preserves absolute note positions.
6. Select the pattern occurrences to compare and mark their next alignment.
   Select a pattern and create a variation to develop it independently.
7. Choose a playback key and press Play. Musical pitches stay relative.

The timeline can scroll horizontally. Cycle boundaries are dashed lines; rests
are explicit marks. Click a note, occurrence, marker, or bar to inspect it.
Exact-properties and whole-document editors remain available for atomic changes
involving multiple references. Validation errors preserve the current song.

Undo any change from the change history. Undoing that undo redoes the change.
Conflicting newer edits are protected. Deleted songs can be restored from the
songbook's **Recently deleted** list.

## Work with an agent

This version uses an **external coding agent** as its reasoning host, with a
loopback Bun bridge to the live browser. It does not bundle a hosted chatbot or
require a model API key in browser code. Start both servers, submit an objective
in the writing-partner panel, and tell your coding agent:

> Read `docs/AGENT_TOOLS.md` in this repository, claim my pending task, and use
> its tools to work on the song. Verify the result before signalling completion.

The external agent controls its model session and reasoning budget. The bridge
limits a task to 100 tool calls, checkpoints delivery after every result, and
keeps cancellation and completion explicit. Keep the task's browser tab open;
if it reloads, its task connection resumes. Server restarts preserve the queue.
Reopening in a new tab currently requires reconnecting that tab to the task's
saved client ID; automatic cross-tab task takeover is not implemented.

Agent mutations and user edits share revision checks, validation, durable
receipts, and change history. An agent receives a conflict instead of silently
replacing newer changes. Stopping a task preserves already committed edits.

## Validate

```sh
bun run verify
bunx playwright install chromium
bun run test:browser
```

`verify` runs strict typecheck, unit/integration tests, and the production build.
Browser tests cover manual editing, output from the audio graph, durable reload,
conflicting tabs, deleted-song recovery, and lost agent responses. GitHub Actions
runs the same automated checks. Real-model evaluation evidence is recorded in
`docs/PHASE1_VALIDATION.md`; deterministic bridge tests are not labelled model
reasoning evaluations.

## Current scope

- Pitches use degree/alteration/octave against a major-scale reference. Mode is
  descriptive; changing it does not reinterpret existing pitches.
- Chords contain notes. Changing a chord's pitches clears an unchanged old
  interpretation. An explicit performance can give members separate attacks and
  releases. A rest releases only its own voice; other voices can keep ringing.
- Bars describe meter. Pattern occurrences use absolute musical positions, so
  rearranging sections changes the meter map rather than moving their independent
  patterns automatically. Moving the relevant occurrences is an explicit edit.
- Audition uses simple oscillators, with a small drum palette. Recording,
  tablature, realistic instruments, full harmonic inference, and remote song sync
  are later phases.
- A song is limited to 20,000 entities and bounded exact arithmetic/expansion.
  Limits return errors; events are not silently rounded or dropped.
- Metadata, operation history, and tasks are stored locally. `.agent/` contains
  bridge credentials, task delivery records, and evaluation browser data; it is
  excluded from git. Browser songs are not stored in that directory.

See [PLAN.md](PLAN.md), [PHASES.md](PHASES.md), and [CONTEXT.md](CONTEXT.md).
