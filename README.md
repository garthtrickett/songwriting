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
   shared meter map. Changing their lengths preserves local offsets and global placements.
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

## Arrange a song

Use **+ Section**, then **+ Bar in section** to build mixed-meter passages.
Select a section card to repeat, reorder, or make an independent variation.
Review the resulting positions and choose **Apply structural edit**. Variations
copy their local music, chords, phrases and lyrics; the source stays intact.
Removing an appearance preserves its reusable section in Musical objects.

**+ Entrance** places a pattern in the selected section. Set its voice, start,
repeat span and ring/cut choice in the inspector. A section placement plays in
all its appearances; global music can span the whole song. The **Attach placement**
control converts a fitting global placement to section time explicitly. It does
not split crossing patterns. In a repeated section, attaching makes that placement
play in every appearance, so check the scope and shared-use count.

Use **+ Phrase** and **+ Lyric** for timed groupings and words. Lyrics support
multiline plain text and optional phrase/part links. Choose **Save lyrics** to
save a draft. If the song changes while typing, the draft remains available and
a stale save is rejected; copy the draft before reloading saved words.

Click a section to jump there. Use zoom and **Fit song** to navigate. With focus
on the timeline, **Space** plays/stops, **← / →** nudges selected notes or
placements by the exact nudge step, **Ctrl/⌘ Z** undoes, and **Ctrl/⌘ Shift Z**
redoes. Text fields keep their normal keyboard behaviour. Navigation is not saved
as music. History lists affected objects, including incoming agent edits.

**Explore an example** opens *Turning rooms*, an editable agent-authored A–B–A′
song with phrases, lyrics, a delayed return entrance, and an unchanged global bass.
The Phase 1 *Countercurrent* example remains in `examples/`.

## Develop a rhythm

Open the **Rhythm workbench** to create an independent riff variation, displace
an entrance, shift its phase, rotate attacks or accents, scale a cycle, or insert
and remove exact time. Fraction inputs use quarter notes. Scaling offers separate
release-duration and phase policies. Review affected objects/placements, then
**Apply rhythm edit**. Each operation is one undoable change. A stale preview
requires a fresh review.

**Build a polyrhythm** creates 2–8 independent voices' pulse patterns over a
shared span, such as 3 against 2 or 5 against 4. Choose existing distinct voices,
division counts, relative pitches/drum sounds and note duration. **Inspect
polyrhythm grids** compares the intended divisions to current attacks and exposes
drift after edits. The declaration does not quantize or overwrite your notes.

**Compare A / A′** shows attacks and groups on the same scale plus exact musical
differences. New variations preserve event origins and copy chords so editing
A′ leaves A intact. **Find cycle alignments** maps chosen placements, including
phases and section appearances, and lets you mark a shared start. Queries do not
save musical changes. Pattern groups and grid declarations have normal inspectors.

Schema 5 imports older songs and their history without moving notes. Older
variations have no inferred event ancestry, so comparison may show additions and
removals. The rhythm example is `examples/crossing-lines.song.json`.

## Develop harmony and voices

The **Harmony workbench** builds chords from a Roman root, quality, extensions,
added/altered or omitted tones, inversion, and an optional applied target such as
V/V. Seventh quality is explicit. Preview the actual contained notes, then apply
one undoable edit. Optionally assign the new chord to an existing chord event;
resetting that event's member performance requires an explicit choice.

**+ Harmonic region** adds a timed relative tonic, mode and annotation. Local
regions repeat with their section and override global context while active.
Choose **Save harmonic region** after editing. All notes still use song-relative
coordinates: I constructed in a V context contains 5–7–2. Changing a region
changes the interpretation without transposing existing music.

Make an independent rhythm variation, then **Transpose a pattern** with both
diatonic steps and semitones. The command copies shared chords before changing
them. **Develop voice leading** previews a minimum-motion octave assignment
between two chords. Applying it changes the target voicing wherever that chord
is used; inspect shared use first. The aid does not judge counterpoint or guitar
playability.

**Shape chord performance** orders member attacks with an exact interval. The
chord-event inspector also edits each member's duration, gain and articulation.
Choose **Save member performance** to commit the draft. **Shape expression**
applies an accent ramp, articulation and exact release multiplier to selected
non-rest events within one pattern. Independent voices and pedal releases remain
separate. Incoming edits preserve drafts and require a fresh review before saving.

Inspect chord candidates under a chosen context, compare voice motion, or inspect
sounding harmony at an exact quarter-note position. Candidates are alternatives
from a finite vocabulary; custom or unresolved labels remain valid. Analysis
includes audible pedal notes, staggered attacks and releases. Adopt a label only
when it fits your intent. `examples/moving-centres.song.json` demonstrates an
applied ninth, an independent transposed answer, local V context and held I bass.

## Arrange guitar and bass

Use **+ Fretted arrangement** to realise a part in a chosen key. **Edit tuning
and capo** opens standard guitar/bass, Drop D and DADGAD presets plus custom open
strings. Enter MIDI pitches in string-number order (string 1 first, normally the
highest); re-entrant tunings retain that order. Frets count above the capo. Save
settings together with **Save fretted arrangement**.

Choose a placed note/member under **Find string positions**, inspect the available
positions, then preview and apply a fingering. Select its tab entry to mark tap,
hammer-on, pull-off, slide, mute or let-ring; connected techniques choose a source
fingering. Assignments repeat with their placement. The time-labelled tab and
note details retain exact attacks, releases and independent voices.

Changing tuning, capo or relative music recomputes pitch compatibility. Diagnostics
show unassigned/stale notes, string collisions across voices, invalid connections
and preferred-hand-span warnings. They help find problems without claiming a hand
solver or guaranteed playability. Musical releases remain unchanged, including
when a connected technique consumes a previous string vibration in the physical
view. The arrangement key is saved separately from the temporary audition key.

`examples/capo-conversations.song.json` demonstrates DADGAD at capo 2 with exact
third-quarter attacks and an independently ringing low voice. Schema 5 imports
older documents/history and preserves stale musical assignment links for repair.

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
`docs/PHASE1_VALIDATION.md`, `docs/PHASE2_VALIDATION.md`, `docs/PHASE3_VALIDATION.md`, `docs/PHASE4_VALIDATION.md`, and `docs/PHASE5_VALIDATION.md`; deterministic bridge tests are not labelled model
reasoning evaluations.

## Current scope

- Pitches use degree/alteration/octave against a major-scale reference. Mode is
  descriptive; changing it does not reinterpret existing pitches.
- Chords contain notes. Changing a chord's pitches clears an unchanged old
  interpretation. An explicit performance can give members separate attacks and
  releases. A rest releases only its own voice; other voices can keep ringing.
- Section-relative placements, phrases and lyrics travel with each appearance.
  Global placements keep their absolute start/span and explicit boundary policy.
  Schema 1 songs migrate as global music so no existing timing is reinterpreted.
  Shortening a section rejects overflowing local spans rather than cropping them.
- Audition uses simple oscillators, with a small drum palette. Recording,
  realistic instruments, full harmonic inference, and remote song sync
  are later phases.
- A song is limited to 20,000 entities and bounded exact arithmetic/expansion.
  Limits return errors; events are not silently rounded or dropped.
- Metadata, operation history, and tasks are stored locally. `.agent/` contains
  bridge credentials, task delivery records, and evaluation browser data; it is
  excluded from git. Browser songs are not stored in that directory.

See [PLAN.md](PLAN.md), [PHASES.md](PHASES.md), and [CONTEXT.md](CONTEXT.md).

## Record and keep ideas

Add a voice, guitar or other part. In **Audio ideas**, import an audio file or
choose a name, part, scope and exact start, then start recording. Microphone access
requires browser permission on localhost or HTTPS. Stop waits for final encoded
chunks to be saved. Select library audio and preview its placement before attaching
it. Click a take to trim its source in seconds or edit timing, gain and mute.
Section-local takes repeat with the section; recordings keep their original pitch
and speed when composition key or tempo changes.

The capture library offers recovery and raw download after interruption or save
failure. Never close the page while it says data exists only in memory. A process
kill can lose the latest unsaved chunk; incomplete codec data may only support raw
export. The app supports one microphone recording per origin at a time.

Use **Export media bundle** to keep music and audio together. Plain **Export JSON**
contains metadata only. Import `examples/echoes-between-bars.songbundle.json` for
a generated guide-tone example (not a human vocal performance). Audio is local to
this browser; browser storage deletion removes it. Undo and deleted-song history
protect referenced audio from unused-library removal. Bounds are 25 MiB and ten
minutes per asset, and 50 MiB audio per bundle before base64 overhead. Browser
codec support varies. Guitar/bass plucks and synthesized drums are writing aids;
this is not a studio mixer or transcription tool.
