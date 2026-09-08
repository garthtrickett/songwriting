# Songwriting app — product and technical plan

Status: Phases 1–7 complete; the Phase 8 arrangement workspace is implemented; broader Phases 8–9 remain planned; see PHASES.md and docs/PHASE7_VALIDATION.md for delivery status. `songwriting` is a working name.

## Built-in Mastra agent — proposed workstream

[MASTRA_AGENT_PLAN.md](MASTRA_AGENT_PLAN.md) specifies the requested replacement
of the hosted app's external-agent dependency with a built-in Mastra assistant.
It includes the reviewed architecture, implementation slices, recovery protocol,
acceptance gates and revision record. Status: plan only, not implemented.
For this proposed workstream it supersedes Phase 7's local-host-only deployment
decision while preserving its musical editing, undo and recovery requirements.
It does not activate Phase 9 song synchronization or the remaining mobile work.

## Song-view redesign

[UI_REDESIGN_PLAN.md](UI_REDESIGN_PLAN.md) records the Ableton-inspired restyle and
layout of the existing song arrangement, with an integrated note editor using
non-key-specific degrees 1–7, alterations and octaves. No Session View or clip
launcher. Implemented with passing local validation; see
[redesign validation](docs/UI_REDESIGN_VALIDATION.md). Phases 1–7 remain complete.

## Product

### Purpose

The end goal is writing math rock. Help write and understand a song's structure:
its sections, phrases, rhythm,
individual notes, chords, and harmonic movement. Basic guitar, drums, bass, and
voice support let the writer hear and develop those ideas. Sound design and
production polish are secondary to expressing the music clearly.

Agent-native interaction is a core product requirement from the first slice.
Writers can compose directly in the editor, describe an outcome to an agent,
or alternate between both while working on the same song.

The central editing surface is a song map: sections and phrase brackets above
a timeline, notes and chord blocks positioned by musical time, and parts and
lyrics alongside them. A writer should be able to see how a verse leads into a
chorus, where a phrase resolves, and how its harmony changes.

### Song structure

- A song has sections such as intro, verse, chorus, and bridge.
- Sections contain phrases and musical events organised into bars and beats.
- The arrangement is an ordered sequence of section occurrences. A section can
  recur; making a particular occurrence different creates an explicit variation.
- Parts describe contributions such as vocal melody, bass, guitar, and drums.
- Meter describes the bars; tempo determines how musical time is heard.
  Notes and chords can occupy subdivisions or extend across bar lines.
- Lyrics and optional harmonic annotations can be attached to the structure.

### Meter and rhythm

Time signatures are defined per bar, with convenient inheritance from the
previous bar. A song or section must never assume four beats per bar or one
unchanging time signature.

- Support simple, compound, and irregular meters, including `3/4`, `6/8`,
  `7/8`, `5/4`, `9/8`, and `11/8`.
- Allow consecutive bars to use different signatures, such as
  `4/4 → 7/8 → 3/4`, including within a phrase.
- Preserve explicit beat groupings. `7/8` grouped `2+2+3` has a different
  rhythmic organisation from `3+2+2`; the editor and metronome must show and
  respect that distinction. Groupings may change without changing the signature.
- Support pickup and intentionally shortened bars, preserving both the notated
  meter and the bar's actual duration.
- Support exact subdivisions and tuplets. Notes and chords may cross a beat
  grouping, a bar line, or a meter change without losing their duration.
- Record the tempo's beat unit explicitly, so a dotted-quarter pulse in `6/8`
  is distinguishable from a quarter-note pulse at the same BPM.

Changing a bar's meter is a structural edit. It must not silently truncate,
stretch, or discard existing notes; the handling of events around the changed
bar must be explicit and undoable.

### Riffs, patterns, and their interaction

Make reusable riffs and motifs central to composition. A pattern contains
musical events and has its own duration. A pattern occurrence places that
pattern in a part at a particular start, with an explicit repeat span and any
chosen variation. Pattern boundaries need not match bar or section boundaries.

```text
Pattern
  notes, chords, rests, accents, and their relative timing
  duration of one cycle

Pattern occurrence
  pattern reference and part
  start, repeat span, and starting position within the pattern
  explicit variation, if any
```

- Support independent cycle lengths: a guitar riff can repeat every seven
  eighth notes while the drums repeat every eight against a shared pulse.
- Preserve the song's bars as a common reference while allowing parts to retain
  their own cycle boundaries and groupings. An independent cycle does not
  automatically change the song's time signature.
- Show the changing alignment of parts and where their cycle starts meet again.
  At a section boundary, explicitly choose whether a pattern continues,
  restarts, or stops. Do not reset every part automatically on a bar line.
- Support explicit polyrhythmic relationships, such as three evenly spaced
  attacks against two over the same span. Show their shared span and subdivision
  relationship as well as the resulting note positions.
- Make variations of a riff: change an ending, remove a note, transpose it, or
  shorten or extend it by a subdivision. Editing one variation must not silently
  change its source or unrelated occurrences; editing a shared pattern clearly
  identifies the occurrences that will change.

Rhythmic editing should include moving a riff by an exact subdivision, rotating
its accents, and proportionally stretching or compressing its rhythm. Each
operation is undoable and makes its treatment of cycle length, overlapping
notes, and occurrence boundaries explicit.

Compare riff A with A′ visually: changed pitches, rhythms, accents, and endings.
The song map should also show instrument entrances, dropouts, and returns so
changes in texture are visible alongside harmony and rhythm.

### Notes, chords, and events

Individual notes and chords are both first-class musical objects. The core
relationship is direct: **a chord contains one or more notes**. Use the same
note representation inside a chord and for a standalone note. The product
allows a nonempty collection, including one note, even though a single note
would not ordinarily be called a chord in musical terminology.

```text
Song
├─ Sections and arrangement
└─ Parts, voices, and pattern occurrences
   └─ Musical events
      ├─ Note event → one note
      ├─ Chord event → chord → one or more notes
      ├─ Rest → deliberate silence in a voice
      └─ Drum event → an unpitched hit
```

A note describes a relative pitch and octave. An event supplies its start and
duration. A chord contains notes independently of how they are performed. Its
default performance strikes those notes together for a shared duration, but an
explicit performance may stagger their attacks or give them different releases.
Associate those performed note events with the chord and its member notes, so
an arpeggio or ringing voicing retains its harmonic identity without requiring
identical timing for every note.

A root-position `I` chord contains degrees `1`, `3`, and `5`. A melody can contain
the same notes one after another. Different octaves, bass notes, and choices of
chord tones express different voicings. Inversions and extended or altered chords
must preserve their actual notes.

Keep the intended Roman-numeral interpretation alongside the chord's notes.
Notes alone do not always uniquely identify a chord's harmonic role. Chord edits
must keep that interpretation and the contained notes consistent, or explicitly
leave the interpretation unresolved. A melody or bass note need not belong to
the accompanying chord; passing notes and suspensions remain valid.

Changing accompanying harmony preserves independently written notes by default.
Adapting those notes to the new chord is a deliberate editing action.

### Voices, expression, and guitar arrangement

A part can contain multiple voices with independent timing. For example, one
guitar can sustain a low note while a higher melody moves; the sustained note
must survive later attacks in the other voice. Overlapping notes and releases
are explicit, including across a pattern boundary.

Preserve accents, dynamics, ghost notes, muted hits, staccato, sustained notes,
and deliberate rests. A rest is scoped to its voice rather than implicitly
silencing an entire instrument. An unmarked gap may remain unfinished music;
the writer can mark intentional silence explicitly.

Eventually support a playable guitar arrangement with alternate tunings, capo
position, string/fret assignments, and technique markings such as tapping,
hammer-ons, pull-offs, slides, and muting. These describe a particular realisation
of the relative composition. Selecting an absolute tonic enables concrete
fingering; transposing or changing tuning must recheck assignments and flag
incompatible ones rather than claiming the same fingering still works.

Detailed guitar fingering tools can follow the core writing workflow. The model
must already support independent voices, note articulation, and the distinction
between relative composition and instrument-specific performance.

### Relative pitch and harmony

Write music relative to a tonal centre, without requiring an absolute key.
Represent a note by degree `1` through `7`, an alteration such as flat or sharp,
and an octave relative to the tonic's reference octave.

Use the major scale as the consistent reference for degree positions, and record
mode separately. Thus `3` is a major third above the tonic and `♭3` is a minor
third, including when the song's mode is minor. Changing mode may suggest new
harmonies; it must not silently reinterpret existing notes.

Roman numerals are the main notation for chords:

| Notation | Meaning |
| --- | --- |
| `I` | Major chord on the tonic |
| `ii` | Minor chord on degree 2 |
| `vi` | Minor chord on degree 6 |
| `vii°` | Diminished chord on degree 7 |
| `iv` | Minor chord on degree 4 |
| `♭VII` | Major chord on the lowered seventh degree |
| `V/V` | Dominant of the dominant |

Uppercase and lowercase distinguish major and minor. Preserve extensions,
alterations, inversions, and applied-chord relationships rather than reducing
every chord to a degree number. Harmonic roles and cadences may be annotated;
they are interpretations in context, not universal properties of a numeral.

Explicitly support suspended chords, omitted thirds, pedal notes, and unresolved
chord labels. A writer can enter a collection of relative notes before deciding
its Roman numeral; do not force a major/minor interpretation onto ambiguous
material. A pedal note can continue beneath changing chords without being
rewritten to fit each chord.

For example, the progression `I – V – vi – IV` can be heard as `C – G – Am – F`
or `D – A – Bm – G` by choosing a playback tonic. The relative composition stays
the same. With the chosen degree convention, a minor progression can be written
`i – ♭VI – ♭III – ♭VII`.

The representation should leave room for changes of local tonal centre, while
keeping their exact editing interaction open for design.

### Saving and ownership

Each song is a complete, portable document containing its musical structure.
Save edits automatically on the device and let the writer reopen the song
without losing its notes, chords, timing, or harmonic interpretation.

Use a readable JSON song format that can be exported as `.song.json` and imported
again. A song with recordings can be exported together with its referenced audio
files. The exact media bundle format remains open. Songs should remain usable
outside the app, and an exported copy provides an independent backup.

Remote backup and cross-device sync are later decisions. Local saving must work
without them.

Shared musical vocabulary is recorded in [CONTEXT.md](CONTEXT.md).

### Agent-native composition

Design reference: Dan Shipper and Claude's *Agent-native Architectures*, supplied
by the user. Adopt its principles of parity, granular tools, composability,
emergent capability, and improvement through context and prompt refinement.
Its experimental native-mobile and self-modification patterns are not automatic
requirements for this browser app.

The agent should pursue musical outcomes by inspecting the song, making edits,
checking the result, and adjusting until the requested outcome is achieved.
Examples include:

- “Make a variation of this riff that arrives at the chorus one eighth note
  earlier, keeping the bass notes unchanged.”
- “Find where the guitar and drum cycles next align and mark that point.”
- “Keep these chord tones, but stagger their attacks into a tapping pattern.”
- “Compare these two sections and explain what changed rhythmically.”

These are examples of composed tool use, not a fixed menu of supported prompts.
The agent must be able to achieve new combinations of operations without a
dedicated feature being implemented for each request. Musical judgment belongs
in its instructions and reasoning; exact timing, valid references, persistence,
and edit semantics remain deterministic application behaviour.

**Parity:** every outcome available through the UI must also be achievable by
agent tools. This includes reading and editing all musical entities, creating
variations, changing arrangement and meter, inspecting selection, auditioning,
undoing, and importing/exporting. Maintain a capability map as features land;
an agent interface added after the editor is complete would miss this requirement.
Browser-required gestures or microphone permission are surfaced as explicit
user steps, rather than pretending an agent can bypass them.

**Shared work:** agent edits appear in the same editor and saved song as manual
edits. Show meaningful progress, affected passages, and the resulting changes.
Let the writer stop a task and undo its edits. Explicitly requested, reversible
edits can apply directly; exploratory alternatives can be created as named
variations when that is the requested outcome. Do not require approval for every
note or tool call. Match confirmation to concrete consequences for unsolicited
or irreversible actions, and honour authorization already given by the writer.

**Learning and customization:** retain editable songwriting preferences and
project context, such as preferred tunings and passages the writer wants to
preserve. Offer reusable, editable prompts for common workflows. Separate
developer defaults, user preferences, and project instructions; make changes
visible and reversible. Use reported tool gaps and user feedback to identify
useful new primitives or shortcuts. Autonomous rewriting of application code
is not part of the initial product.

**Interruption:** display task progress and distinguish completed, partial,
failed, cancelled, and waiting-for-input work. Preserve committed edits and
enough context to resume after a reload, network failure, or context limit.
The writer can keep editing manually when agent reasoning is unavailable.

### First useful math-rock milestone

Create a seven-eighth-note guitar pattern over an eight-eighth-note drum pattern
starting together against a common eighth-note pulse. Display their changing
alignment and their next shared cycle start after 56 eighth notes. Sustain a
bass note underneath, then create a shortened guitar variation leading into
the next section with an explicit continue/restart/stop choice for each pattern.

This slice must support relative notes and a chord containing notes, visible
accents and rests, independent note durations, editing and undo, basic audition
and metronome playback, and save/export/import/reopen without losing structure.
Include a mixed-meter passage to verify that a bar change does not accidentally
restart an independently repeating pattern.

Run this milestone through both direct editing and agent tools. The agent must
also complete a request combining existing primitives in a way with no dedicated
workflow tool, such as shortening a riff variation while preserving a bass voice
and marking the next cycle alignment. Its edits must appear immediately, survive
reload, respect intervening user edits, and be undoable.

## Technical foundation

Carry over the notes app's small toolchain and explicit state management, with
separate modules for the song model, audio playback, recording, and storage.

Reference implementation: `/home/gust/files/code/notes`. This plan is based on
its actual `package.json`, `tsconfig.json`, `src/result.ts`, `src/loop.ts`, and
test setup. Copy useful code into this project; do not import files from the
notes app at runtime or couple the two applications through a shared package.

### Dependencies and imports

| Carry over | Use here |
| --- | --- |
| `lit-html` | Standalone templates and rendering for the app shell, tracks, controls, and dialogs. |
| `typescript` | Strict type checking, separate from bundling. |
| `vite` | Development server and production browser build. |
| Bun and `bun:test` | Dependency installation, lockfile, scripts, and unit/integration tests. |
| `@types/bun` | Types for the test runner and Bun tooling. |
| `@happy-dom/global-registrator` | Simulated DOM for fast view and interaction tests. |
| `fake-indexeddb` | Exercise local persistence without a real browser database. |

Typical imports:

```ts
import { html, render, nothing } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { describe, expect, it } from "bun:test"; // tests only
import type { Song } from "./song/model.ts";
import { ok, err, attemptAsync, type Result } from "./result.ts";
```

Use ES modules, explicit relative `.ts` imports, and `import type` for types.
Keep browser code independent of Bun runtime APIs. Start with one package and
ordinary modules; introduce shared packages only when there is an actual second
consumer.

Do not carry over CodeMirror or `marked` automatically. Choose a lyrics editor
when its editing requirements are clear. The notes app's GitHub client, PAT
configuration, markdown paths, daily dump, and vault sync are application logic,
not scaffolding for this app.

Use browser Web Audio and microphone APIs behind the audio modules. Selection
of an instrument library or sample library remains open; no audio package is
selected by this plan. Resolve package versions when scaffolding, commit the
lockfile, and pin the Bun version used locally and in CI.

### TypeScript and commands

Carry over the notes app's compiler settings:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "types": ["bun"]
  },
  "include": ["src", "vite.config.ts"]
}
```

Retain `dev` (`vite`), `check` (`tsc --noEmit`), `test` (`bun test`), and
`build` (`vite build`). Add `verify` to run check, tests, and build in order;
CI runs that same command after a frozen-lockfile install. A successful Vite
build does not substitute for type checking.

### State management

Carry over the notes app's SAM (State-Action-Model) pattern:

```text
user intent / agent command / completed async operation
                  ↓
              proposal
                  ↓
       present(model, proposal)
                  ↓
          schedule rendering
                  ↓
    nap(): start necessary side effects
                  ↓
      action → Result → proposal
```

- Represent proposals and expected errors as discriminated unions.
- Keep model transitions synchronous. `present()` accepts or rejects a proposal
  and owns song and UI changes; views only read state and propose actions.
- Keep rendering free of storage, recording, or playback side effects.
- Follow the notes implementation's actual ownership rule: the loop may own
  operation bookkeeping such as in-flight saves. Async actions receive captured
  inputs and dependencies, never the live mutable model.
- Inject storage, audio, time, ID generation, and scheduling where used. Build
  concrete dependencies in `main.ts`; tests supply controlled implementations.
- Carry over the small `Result<T, E>`, `ok`, `err`, and `attemptAsync` helpers.
  Convert expected browser/storage failures into typed proposals that the UI
  can display and recover from.
- Tag async work with project identity and revision or operation identity.
  An old save completion must not clear newer edits, and a recording completion
  must not attach to a different song opened while recording was in progress.

Maintain three distinct kinds of state:

| State | Contents | Owner |
| --- | --- | --- |
| Saved song | Stable musical object IDs, sections, arrangement, patterns and occurrences, voices, relative notes, chords containing notes, performances, rests, accents, articulation, timed events, meter, tempo, harmonic interpretations, lyrics, instrument settings, audio asset references | Song model and editing operations |
| UI/session | Selection, zoom, dialogs, pending operations, visible errors | App model and loop |
| Live audio | Audio context, nodes, decoded buffers, microphone streams, playback schedule | Audio engine and recorder |

Undo/redo applies to song edits. It must not rewind network requests, microphone
permissions, or audio resources. Group continuous edits such as a clip drag into
one undoable operation.

### Agent tools and shared editing interface

Expose the same headless editing interface to UI handlers and agent tools.
Commands enter the existing proposal/transition path and return an explicit
accepted or rejected result. Neither an agent nor a UI handler writes around
the model into IndexedDB. Separate commands requesting edits from internal
completion proposals, so a tool cannot fabricate a successful save or recording.

Tools represent one conceptual action. They can perform mechanical validation
and use optimized code, but must not bundle musical judgment into workflows
such as `analyze_and_rewrite_song`. Start with a small composable surface:

| Capability | Tool primitives or compositions |
| --- | --- |
| Discover the workspace | List songs, inspect schema and capabilities, read current song/selection/revision |
| Inspect music | Read a section, pattern, voice, or time range; search events and references |
| Edit entities | Create, read, update, and delete supported entities by stable ID |
| Arrange music | Place/move/remove pattern and section occurrences; edit phase and repeat span |
| Develop a riff | Copy a pattern into a variation, edit notes or accents, transform exact timing |
| Inspect rhythm | Query cycle alignment and event positions; add a marker or annotation |
| Hear and review | Control audition and metronome, inspect changes, undo or redo a change group |
| Own the document | Read/export song JSON, validate/apply document edits, import/export media bundles |

Domain shortcuts must leave the underlying edit primitives available. Provide
a general, revision-checked document-edit operation for valid edits not covered
by a shortcut. Structural validation protects exact timing and referential
integrity; it must not reject unusual but representable music merely because
it falls outside an anticipated style or chord vocabulary. Multi-entity changes
may be committed atomically so intermediate invalid references are never saved.

Tool schemas and responses are machine-readable and discoverable. Include stable
IDs, revisions, affected objects, and actionable error details. Audit create,
read, update, and delete coverage for every editable entity, including project
preferences and annotations. Keep optimized operations callable by agents as
they are introduced.

### Agent workspace, concurrency, and execution

Keep one authoritative song document in the shared IndexedDB workspace. Expose
its JSON representation through tools with the same schema used for export.
IndexedDB is not directly accessible to an external filesystem agent: an agent
connection must explicitly bridge into the app's editing interface.

An optional document adapter can expose an understandable project view such as
`songs/<song-id>/song.json`, `notes.md`, and referenced assets. File imports or
edits must pass through the same validation, revision check, and change history.
Do not introduce independently writable file and database copies with implicit
last-write-wins synchronization. Raw database writes and arbitrary browser-host
filesystem access are not required for parity; shared editing semantics are.

Every mutation carries the expected song revision and an operation ID. Check
the revision and commit atomically, including across browser tabs. On conflict,
return the current revision and affected context so the agent can reread and
revise its proposal. Never overwrite user edits made since the agent's read.
Deduplicate committed operations on retry, including after a lost response.
Group related edits for review and undo; undo must detect intervening changes
instead of restoring an old whole-song snapshot over newer user work.

At session start, supply the current song, selection, available resources,
capabilities, project/user instructions, and recent activity. Provide bounded
summary, range, and detail reads with a refresh operation; do not require the
entire song and conversation in every model context. Persist editable project
notes and preferences separately from execution checkpoints. The repository's
`CONTEXT.md` remains a musical glossary, not agent working memory.

The agent execution loop is asynchronous and separate from the synchronous SAM
transition loop and audio scheduling. It reads state, calls tools, receives
results, and decides its next step. Define explicit task states and an explicit
completion signal; a successful tool call or a quiet response is not proof the
task is complete. Completion reports what changed, what was verified, and any
remaining work. Show concise progress summaries, tool activity, and edit results
without depending on access to hidden model reasoning.

Checkpoint after tool results and meaningful task transitions. Store the task
objective, progress, committed operation IDs, relevant document revisions,
conversation/context summary, and prompt/tool versions. Resume by refreshing
live state and reconciling pending operations before issuing more mutations.
Support cancellation, recoverable errors, partial completion, and waiting for
input explicitly; interruption must not replay already committed changes.

Choose the provider, model, SDK, connection protocol, execution host, and task
cost/iteration limits during implementation. No provider-specific dependency is
selected by this plan. A local or hosted bridge is an explicit addition to the
browser architecture; it must keep provider secrets out of shipped browser code.
Do not assume browser background execution continues after the app is suspended.
Keep manual composition available offline, and show when agent reasoning needs
an unavailable connection. Treat imported lyrics and reference material as
content rather than authority to change the agent's instructions or permissions.

### Audio timing and resource ownership

The app loop requests playback, stopping, seeking, and recording. The audio
engine owns scheduling against the audio clock. UI rendering and timer callbacks
must not determine the exact moment a drum hit or bass note sounds.

Keep the playhead and meters as transient visual updates; do not route every
animation frame through song edits, autosave, or undo. Audio resources stay out
of the saved model. Give the engine and recorder explicit cleanup so project
switches and teardown stop owned sources, release streams, and discard stale
work.

Reference for audio-clock scheduling:
[Web Audio specification](https://www.w3.org/TR/webaudio-1.0/).

### Persistence

Carry over local autosave, injected storage, and tests that prove data survives
a reload. Adapt the IndexedDB module to songs instead of copying its note schema.

Store one structured song document per song in IndexedDB, directly as an object.
JSON is its portable interchange format; stringify on export rather than storing
JSON strings inside IndexedDB. Start with `songs`, `assets`, and `settings`
stores. Keep notes and chords inside the song document rather than creating a
database record for every individual note.

Add separate durable records for agent sessions/checkpoints and operation/change
history as those capabilities land. Persist project instructions and reusable
prompts as inspectable, exportable content. The canonical musical document must
remain usable without retaining agent conversations or execution history.

Represent musical positions and durations as exact fractions of a quarter note,
using integer numerator/denominator pairs. For example, `[4, 1]` is four quarter
notes and `[1, 3]` is one third of a quarter note. Validate denominators and
normalise fractions. Bar and beat labels are derived from the meter map.

The meter map must resolve a signature and beat grouping for every bar. Store
the numerator, denominator, and ordered grouping separately: for example,
`7/8` with groups `[2, 2, 3]`, measured in denominator-note units. Validate that
groups are positive integers and sum to the numerator. A full bar lasts
`numerator × 4 / denominator` quarter notes; preserve this as an exact fraction.
Store an explicit actual duration for incomplete bars. Resolve bar starts from
these durations rather than multiplying a bar index by four. Keep the notated
signature unreduced (`6/8` and `3/4` are distinct meters despite equal length).
Represent tempo with both BPM and its beat unit; the quarter-note storage unit
does not imply that every musical beat is a quarter note.

Persist pattern definitions once and reference them by ID from occurrences.
Store cycle duration independently of the song's meter, with exact occurrence
starts, repeat spans, and phase offsets. Preserve variation identity and explicit
continuation choices. Event positions inside a pattern are relative to that
pattern; the timeline resolves occurrences into song time. Preserve note tails
and explicit release choices when cycles repeat or occurrences end.

Keep chord membership distinct from its performance timing, using stable member
references for performed notes. Store intended polyrhythmic ratios and spans,
voice identity, rests, accents, and articulations alongside exact event timing.
Runtime validation must detect broken pattern/chord references and incompatible
edits instead of silently dropping musical information.

- Save versioned song metadata with runtime validation and an explicit migration
  path. TypeScript types alone do not validate imported or stored data.
- Store samples and recorded takes as binary blobs, referenced by asset ID.
  Keep large bytes outside the reactive model and avoid base64 encoding audio.
- Make asset publication and metadata updates transactionally consistent where
  possible, so a saved clip never points at bytes that were not successfully stored.
- Provide a project export/import path containing metadata and required assets;
  local browser storage is not the entire backup story.
- Decide remote sync separately. The notes app's GitHub markdown sync is not
  the default storage backend for recordings.

Carry over the offline app-shell idea when adding PWA support. Review cache
lifecycle and sample storage explicitly rather than copying the notes service
worker unchanged.

### Initial module layout

```text
src/
  main.ts                 # construct and connect dependencies
  result.ts               # typed result helpers from notes
  app/
    model.ts              # UI/session state and proposals
    loop.ts               # transitions and side-effect orchestration
    view.ts               # lit-html rendering
    keys.ts               # keyboard intent mapping
  song/
    model.ts              # serializable song types
    edits.ts              # editing rules and undo/redo
    format.ts             # save format, validation, migrations
    commands.ts           # shared UI/tool edits and explicit results
  agent/
    tools.ts              # discoverable tools over shared commands and queries
    session.ts            # execution, progress, cancellation, checkpoint/resume
    context.ts            # bounded song context, preferences, prompt assembly
  audio/
    engine.ts             # playback, scheduling, mixing
    instruments.ts        # instrument definitions
    recorder.ts           # microphone and recording lifecycle
  storage/
    projects.ts           # metadata persistence and autosave
    assets.ts             # samples and recorded takes
  test-setup.ts           # DOM and IndexedDB test setup
```

Tests live beside the modules they exercise. Keep these as ordinary modules
with small interfaces; add files as behaviour requires them.

### Validation to carry over and extend

- Bun tests for model transitions, rejected edits, undo/redo, and format
  round-trips.
- Musical-model tests for standalone notes, chords containing notes, exact timing,
  relative-pitch transposition, voicings, and preservation of intended harmonic
  interpretations through save/export/import.
- Meter tests for mixed signatures within a phrase, alternative additive
  groupings, compound-meter pulses, pickup bars, tuplets, and notes spanning a
  meter change. Verify exact bar positions and preservation through save/load.
- Controlled time and delayed completions for autosave races, project switching,
  and stale async results.
- Pattern tests for independent cycle lengths, phase offsets, the seven/eight
  alignment after 56 eighth notes, section-boundary continuation, and variation
  isolation. Verify shared-pattern edits identify all affected occurrences.
- Tests for three-against-two timing, rhythmic transformations, overlapping
  voices and note tails, per-note chord performance, voice-scoped rests, accents,
  and unresolved harmonic labels. Preserve these through save/export/import.
- When guitar arrangement tools land, test tuning/capo interpretation and
  invalidated fingerings after transposition or tuning changes.
- Fake IndexedDB integration tests proving metadata and recordings survive reload.
- Capability-map tests proving UI/tool outcome parity and complete CRUD coverage.
  Run equivalent manual and tool edits through the same model assertions.
- Tests for stale revisions, concurrent user/agent edits, atomic document updates,
  idempotent retries, and undo with intervening changes.
- Agent session tests for interruption after a committed edit but before its
  response, checkpoint recovery, cancellation, partial completion, context
  refresh, and explicit completion signals.
- End-to-end agent evaluations for the math-rock milestone and novel compositions
  of tools. Verify the resulting musical structure and preservation constraints,
  not merely the agent's claim of success. Pin evaluation fixtures and record
  model/prompt versions; keep deterministic edit correctness tests independent
  of model behaviour.
- DOM tests for controls, keyboard focus, and shortcuts while editing lyrics.
- Real-browser checks for audio scheduling, playback, recording, permission
  denial, and cleanup. Simulated DOM tests cannot establish audio correctness.

The first implemented slice is the product's math-rock milestone above.
Instrument selection, sample sources, recording formats, the media bundle
format, remote sync, detailed guitar fingering interactions, the browser test
tool, and the agent provider/host/connection are still decisions to make during
implementation. Agent parity and the shared editing interface are foundational
requirements, not deferred integration work.


## Phase 3 — Advanced rhythm and motif development

**Status:** DONE — local checks, live-agent evaluation and GitHub verification passed.
Evidence: [docs/PHASE3_VALIDATION.md](docs/PHASE3_VALIDATION.md).
This is the detailed Phase 3 specification; PHASES.md links
here rather than maintaining a second detailed copy.

### 3.1 Musical representation and compatibility

- Introduce schema 3: optional-in-meaning pattern beat groups represented as an
  ordered list of exact quarter-note durations (empty means ungrouped), stable
  event origin identities for variation comparison, and a polyrhythm table.
- Nonempty pattern groups must sum to the cycle length. They describe a riff's
  own grouping, independently of the song's written meters and bar groups.
- A polyrhythm span has a name, section/global scope, exact start/duration and
  two to eight lanes. Each lane references a distinct pattern occurrence and
  declares 1–64 equally spaced divisions of that shared span. Referenced
  occurrences must have the same scope and distinct voices.
- The declaration is an intended grid, not an instruction to rewrite music.
  Show its expected event attacks alongside actual attacks and whether they
  match. Editing linked music can make a declaration differ; preserve both and
  show that difference. Chord-member offsets remain independent performance
  information; the grid compares event attacks, not every member's attack.
- Migrate schemas 1/2, stored history and deleted-song snapshots without moving
  existing notes or changing revision/operation fingerprints. Existing patterns
  are ungrouped; events receive their own ID as origin. Do not infer ancestry
  for old variations. Preserve new data through JSON export/import and undo.

### 3.2 Exact, composable rhythm commands

Use `kind: rhythm` on the existing revision-checked mutation path. Each command
has a preview, one atomic commit, durable retry identity and ordinary undo/redo.
Show shared-pattern impact before applying a transform. Keep entity primitives.

- **Independent pattern variation:** copy a pattern, events and referenced
  chords; retain event origins for comparison, preserve internal chord sharing,
  and leave occurrences unchanged until explicitly retargeted.
- **Displace placement:** move an occurrence start by an exact signed amount,
  preserving its span, phase and all notes. Reject negative/out-of-section time.
- **Change phase:** add a signed amount to an occurrence phase and wrap exactly
  within its cycle. This changes the entry into the riff, not its placement.
- **Rotate attacks:** move event starts within a pattern by a signed amount,
  wrapping within the cycle; keep releases and chord-member offsets unchanged.
- **Rotate accents:** rotate accent values among non-rest events in exact attack
  order, breaking simultaneous-attack ties by ID. Leave notes and timing intact.
- **Scale rhythm:** multiply cycle length, groups, event starts and performed
  member offsets by a positive fraction. Explicitly choose whether release
  durations scale or stay fixed, and whether occurrence phases follow the
  transform or retain their exact values. Occurrence starts/spans stay fixed;
  invalid retained phases are rejected.
- **Insert/remove subdivision:** insert/remove an exact span of pattern time.
  Shift following event and member attacks; preserve their independent durations.
  Removal either rejects attacks in the cut or explicitly deletes whole events
  whose base attack lies there. Reject cuts through a later chord-member attack
  unless the entire event is being deleted. Never silently discard a chord member.
  Adjust group lengths by the inserted/removed time, dropping only empty groups.
  Explicitly choose phase-follow or phase-keep; follow maps a removed phase to
  the cut point and wraps if that becomes the cycle end. The cycle stays positive.
- **Build polyrhythm:** given scope/span, voices, division counts, relative
  degrees/drum sounds and note duration, create ordinary patterns/events and
  placements plus their declaration. No special playback path or model-generated
  composition workflow. Removing the declaration leaves its music intact.

For insertion at a grouping boundary, grow the following group; insertion at
cycle end grows the last group. Pattern grouping stays in place during attack
rotation and accent rotation. Global bass, other patterns, lyrics, meters and
chords outside the selected transform remain unchanged.

### 3.3 Rhythm workbench and comparison

- Provide ordinary controls for all commands, including fraction inputs and
  release/phase choices. Previews capture a revision, show changes and affected
  placements, and reject application after intervening edits.
- Edit pattern groups and polyrhythm declarations with normal inspectors. Show
  expected/actual polyrhythm grids and the declaration's match status.
- Compare two patterns in a shared-scale visual with a difference table for
  added/removed events, exact timing, pitch/chord content, accent, articulation
  and member performance. Match by event origin; explain that unrelated/legacy
  patterns may appear as additions/removals. Include cycle length/group changes.
- Provide a bounded cycle map for 2–8 occurrences over an exact time range,
  including phase and arranged repeats. Show cycle starts, shared starts, empty
  intersections, and explicit truncation when more than 512 points are available.
  Let the writer select occurrences and mark a chosen shared start in the song.
- Keep note tails visible and playback on the existing exact timeline/audio
  engine. Navigation, comparisons and queries never create musical edits.

### 3.4 Shared tools, validation and acceptance

- Extend schema discovery with command templates and argument schemas, entity
  CRUD, comparison, polyrhythm-grid and all-alignments queries. Extend the
  capability map. Copy section-owned declarations and relink their occurrences
  when making section variations.
- Unit/integration checks cover 3:2/5:4 grids, exact scale/inverse, negative phase
  wrap, insertion/removal at group boundaries, chord-member offsets/releases,
  explicit deletion/rejection, rest preservation, source isolation, migration,
  stale previews, durable retries and undo/redo through tools.
- Browser checks exercise normal transformation and polyrhythm controls, source
  comparison, alignment marking, stale previews, saving/reloading/exporting,
  and audition via the existing audio engine. Retain prior regression checks.
- Run a live agent evaluation: build 3:2 in independent voices, make a riff
  variation, transform it, compare it to its source, and inspect cycle alignment.
  Independently verify exact positions, unchanged source/bass, persisted JSON
  and explicit task completion. Record objective, tool version and model identity
  as exposed, without calling a scripted browser test a model evaluation.
- Run frozen install, `bun run verify`, all browser checks and whitespace checks;
  publish one Phase 3 PR, fix failures and wait for exact-commit CI before merge.

### Exit gate and exclusions

A writer and an agent can develop a rhythmically distinct A′, understand exactly
what changed, hear independent polyrhythmic parts and identify shared cycle starts.
These outcomes survive import/export/reload, undo and concurrent edits. All checks
above pass and evidence is recorded in docs/PHASE3_VALIDATION.md.

Do not implement Phase 4 harmony inference, guitar fingering, recording, remote
sync, a notation engraver or hosted model orchestration. Rhythm tools must not
change musical pitch unless an explicitly entered note/declaration asks for it.

## Phase 4 — Harmonic writing and independent voices

**Status:** DONE — local checks, live-agent evaluation and GitHub verification passed.
Evidence: [Phase 4 validation](docs/PHASE4_VALIDATION.md). PHASES.md links here.

### 4.1 Explicit notes and local harmonic context

- Schema 4 adds harmonic regions: named, timed spans with section/global scope,
  a tonic expressed relative to the song tonic, mode, and plain-text annotation.
  Same-scope regions cannot overlap. Local regions repeat with their section and
  override global regions while active. Use half-open spans; outside a region,
  the song tonic and descriptive mode apply. Region edits never transpose notes.
- Chord labels gain an explicit `labelTonic` so a contextual Roman interpretation
  has a readable reference. Notes remain authoritative song-relative pitches.
  Constructing I in a V context writes 5–7–2 in song coordinates. Changing context
  or playback key never rewrites pitches. Labels can remain arbitrary or null.
- Migrate schema 1–3 documents, history values and deleted snapshots additively;
  preserve revision/fingerprints, pitch spelling, exact time, and undo. Existing
  labels refer to song I. Section variations copy their local harmonic regions.
- Optional chord-member gain and articulation override the event defaults.
  Missing values mean gain 1 and inherited articulation, preserving old playback.

### 4.2 Chord construction and development

Provide one shared `harmony` command path with revision-bound previews and one
undoable receipt per action. Expose templates to agents and retain entity CRUD.

- **Build chord:** choose a Roman root/alteration, major/minor/diminished/augmented/
  sus2/sus4/power quality, seventh quality, extension through 13, optional added or
  altered chord tones, omitted tones, and inversion. Applied targets such as V/V
  are explicit relative roots. Construct notes with diatonic spelling and octave
  placement; never reduce voicings to pitch-class sets in storage. Use explicit
  `maj7`, `7`, and diminished-seventh labels to distinguish quality.
- Inversion rotates the selected number of lowest retained chord tones upwards
  until above the remaining voicing; omissions can change which tone is the bass.
  Label the actual retained bass tone rather than guessing figured bass.
- The builder creates a new chord; optionally assign it to a chosen chord event
  atomically. Other events, melodies, bass and shared definitions stay unchanged.
  Reassignment requires explicit reset or rejection of incompatible member
  performances. Existing custom notes remain fully editable without the builder.
- **Transpose pattern:** explicitly choose diatonic steps and chromatic semitones.
  Preserve time, event identity/origins, accents and performance. Copy referenced
  chord definitions before editing so other patterns retain them; clear copied
  interpretations. Preserve rests/drums. Offer independent variation first.
- **Voice leading:** compare two 1–8-note chords and choose a target octave search
  radius of 0–2. A bounded minimum-total-semitone assignment reports matched,
  added and removed voices; unequal sizes are explicit. Applying changes only
  target member octaves, preserving IDs, pitch classes, and event performance.
  Report shared target usage and clear its stale label. This is an octave/motion
  aid, not a claim of stylistically correct counterpoint or playable fingering.
- **Chord performance:** order every member once with an exact attack step, and
  either preserve independent durations or choose a common duration. Existing
  member expression stays attached to its ID. Normal inspector rows edit each
  member's offset, duration, gain and articulation; save a revision-bound draft.
- **Expression:** apply a linear accent ramp in exact attack order to selected
  non-rest events within one pattern, choose articulation, and multiply durations by an exact positive
  gate factor. Attacks/pitches and unselected voices remain unchanged. Member
  durations scale too; member expression overrides remain explicit.

### 4.3 Contextual inspection and ordinary editing

- A harmony workbench provides ordinary controls for all commands, including
  applied targets, alterations/omissions, inversion, context selection, transpose,
  performance and expression. Preview contained notes and affected patterns,
  placements/events before applying. Reject stale previews and preserve drafts.
- Add/edit/delete harmonic regions with normal controls and show their arranged
  spans alongside the timeline. A context change is an annotation, not a hidden
  transposition. Unarranged local contexts remain editable.
- Read-only chord inspection offers exact pitch-class matches from a documented
  finite chord vocabulary, in the chosen relative context. Return alternatives,
  actual bass and mode-membership information. Unrecognised/ambiguous collections
  stay unresolved. Do not infer cadences or force one function onto the music.
  A writer can explicitly adopt a candidate or retain/write another label.
- Read-only sounding-harmony inspection uses the existing realised timeline,
  including staggered member attacks, releases, rests, mute state, and independent
  voices. Show sounding relative notes by voice and active context at exact time.
  A sustained pedal is part of the actual aggregate even when it prevents a simple
  chord interpretation. Context/analysis queries make no musical edits.
- Compare voice-leading motion in a table with source/target member IDs and signed
  semitone moves. Keep arrangement timing and independent voice releases visible.
- Dynamics/articulation changes flow through the existing audio engine. A member
  may inherit or override its event's articulation; do not apply staccato twice.

### 4.4 Validation, agent parity and exit gate

- Extend discovery, capability map and full entity CRUD with harmonic regions,
  builder recipes, harmony commands, chord candidates, sounding harmony, context,
  and voice-leading queries. UI/tool edits must reach the same headless logic.
- Test major/minor/applied chords, extensions, altered/omitted tones, suspensions,
  inversions and enharmonic spelling; context precedence and repeated sections;
  exact staggered attacks/releases and per-member expression; independent bass;
  transposition isolation; optimal bounded voice matching; ambiguity; migrations;
  invalid references; stale previews/drafts; retries; undo/redo and JSON round trips.
- Browser workflows use ordinary chord/context/performance/voice-leading/expression
  controls, audition the audio graph, preserve a pedal voice, and reload/export.
  Retain all previous regression checks and deliberate asynchronous-save coverage.
- Run a live agent evaluation through the browser bridge: build applied/extended
  harmony over an unchanged pedal, set a local context, vary/revoice or transpose
  a part, stagger a chord, inspect the sounding result and export. Independently
  verify pitches, exact timing and preservation, and record explicit completion.
- Frozen install, `bun run verify`, all Chromium workflows and `git diff --check`
  must pass. Publish one Phase 4 PR, fix failures, verify its exact final commit,
  then merge and record evidence in docs/PHASE4_VALIDATION.md.

Phase 4 is complete when a writer and an agent can construct and develop relative
harmony, inspect its context and voice motion, preserve independent melodies and
pedals, and retain the result through concurrent edits, undo and saving.

No guitar fingering, recording, notation engraving, remote sync, hosted reasoning,
or automatic functional/cadential analysis. Analysis vocabulary and octave search
are deliberately bounded; arbitrary explicit note collections remain supported.

## Phase 5 — Playable guitar and bass arrangements

**Status:** DONE — local checks, live agent evaluation and GitHub verification passed.
Evidence: [Phase 5 validation](docs/PHASE5_VALIDATION.md). Phases 6 and 7 are authorized next.

### 5.1 A fretted realisation alongside relative music

Schema 5 adds `fretted` arrangements and `fingerings`. A fretted arrangement
belongs to a guitar/bass part and stores a chosen absolute tonic (MIDI note),
open-string tuning in string-number order (string 1 first, normally highest),
capo, physical last fret, and a preferred fretting-hand span. Alternate and
re-entrant tunings are valid; do not sort strings. Fret numbers are relative to
the capo: sounding MIDI = open tuning + capo + relative fret. A realisation's
chosen tonic is distinct from the temporary audition key.

A fingering links an arrangement, pattern occurrence, event and optional chord
member to a string, relative fret, technique and optional source fingering.
Assignments repeat with that occurrence, including section appearances. Different
placements can use different positions. Relative notes, chord membership, voice
identity and exact attacks/releases remain the authoritative composition.

Migrate schemas 1–4 and history additively. Keep old receipt fingerprints and
undo. Structural validation checks arrangement references, numeric bounds and
unique assignment targets. Musical links may become stale after deleting or
retargeting music: retain them for explicit diagnostics/removal instead of
blocking composition edits or silently reassigning them. Section variations copy
local assignments and relink copied events/occurrences and technique sources;
independent pattern variations acquire positions when explicitly placed/assigned.

### 5.2 Position choices and playable diagnostics

- Read-only position search returns every in-range string/fret for one relative
  note/member under the selected arrangement's tonic/tuning/capo. No result is
  explicit, with no octave substitution or note deletion.
- Read-only arrangement inspection derives timed tab rows from the existing
  realised timeline, preserving meter changes, tuplets, repeated placements,
  independent voices, voice-scoped rests, and ringing tails. Include member IDs
  directly in realised sounds rather than parsing concatenated identifiers.
- Flag unassigned/stale targets, wrong pitches after transposition/retuning,
  unavailable strings/frets, simultaneous/sustained string collisions and wide
  fretting-hand spans. Check across voices and placements on the same instrument.
  Touching release/attack endpoints are compatible. Span excludes open strings
  and tapping-hand notes; it is a configurable warning, not proof of ergonomics.
- Techniques: pluck, tap, hammer-on, pull-off, slide, mute and let-ring. Connected
  techniques require a source on the same string and voice with appropriate fret
  direction (up for hammer-on, down for pull-off, different for slide). Inspect
  actual arranged timing: a source must sound up to the target, with no intervening
  string attack. A valid connection replaces its source's string sustain for
  physical diagnostics only; it never rewrites musical releases. Bad connections
  and unavoidable sustained-string conflicts stay visible.
- Bounds: 1–12 strings, MIDI 0–127, capo 0–24, physical frets up to 36; read ranges
  use exact nonnegative quarters with at most 512 displayed attacks. Return totals
  and truncation; collision analysis considers ringing notes entering the range.
  Reject unbounded diagnostic work explicitly rather than claiming playability.

### 5.3 Ordinary controls and tool parity

Provide a fretted-arrangement workbench with standard guitar/bass and alternate
presets, editable tuning/tonic/capo/fret/span settings, occurrence/event/member
selection, position choices, manual assignments and technique/source selection.
Use revision-bound previews for position edits and preserve setting drafts on
conflict. Show a time-labelled tablature grid (string 1 at top), voice, exact
release, technique and issues, with links back to editable objects. Show when the
audition tonic differs and offer an explicit audition-key change.

All entities retain complete CRUD and ordinary inspectors. Tools expose schemas,
position search and arranged-tab queries and use the same validated `edit` /
`preview` / `mutate` path. Tuning changes, position edits and deletion are undoable.
No automatic hand solver, instrument-position canonical model, PDF engraving or
physical playability guarantee is implied.

### 5.4 Validation and exit gate

Test standard/alternate/re-entrant tuning, bass, capo arithmetic, exact member
attacks, independent sustained-string conflicts, connecting techniques, out-of-
range notes, stale assignments after transposition/tuning changes, section copies,
migration/history/retries/undo, and bounded queries. Browser workflows use ordinary
controls, preserve drafts across foreign edits, and save/import/export/reload.
Retain all prior regressions. Run a live agent composition through the bridge and
independently verify absolute pitch/string/fret arithmetic and unchanged music.

Frozen install, `bun run verify`, all browser checks and `git diff --check` must
pass. Publish a phase5 PR, verify its final commit on GitHub, merge it, record
`docs/PHASE5_VALIDATION.md`, then expand and implement Phase 6.

## Phase 6 — Voice capture, media, and useful instrumental playback

**Status:** DONE — local checks, live agent evaluation and GitHub verification passed.
Evidence: [Phase 6 validation](docs/PHASE6_VALIDATION.md).

### 6.1 Media belongs to the composition without becoming musical pitch

Schema 6 adds audio asset metadata and takes, and a voice instrument type. Asset
identity is a SHA-256 digest of encoded bytes; metadata includes name, MIME,
byte count and decoded duration. Binary data lives in a dedicated IndexedDB store,
shared by content identity. Takes reference an asset and part, optional section,
exact start in quarters, source offset and duration in seconds, gain and mute.
Several takes can preserve alternatives; explicitly choose which are audible.

Section-local takes repeat with section appearances and copy into variations;
global takes retain their absolute musical start. Starts must fit the scope;
recorded releases may ring beyond a section. Tempo changes move musical anchors
but never stretch/pitch-shift recorded media. Trims are nondestructive seconds
within the decoded asset. Take playback stays in the recorded key even when the
relative composition's audition tonic changes. Preserve this distinction visibly.

Migrate schemas 1–5 and history additively. Upgrade IndexedDB without destroying
songs/settings/sessions. Binary retention protects undo and deleted-song recovery.
Deleting a take or metadata never silently deletes audio. Explicit unused-asset
removal must check all songs, deleted snapshots, undo/redo values and capture
checkpoints in one transaction; no automatic garbage collection.

### 6.2 Durable import, recording and recovery

- Import a decodable audio file into the local media library, validating MIME,
  bounded size and decoded duration before reporting it usable. Compute identity
  from actual bytes. Equal audio deduplicates without overwriting content.
- Store audio before attaching a take. A revision conflict or failed musical save
  leaves the audio in the library for retry. Attach metadata/take atomically through
  the shared command path with a revision captured for the reviewed placement.
- Record only after an explicit start action, with browser microphone permission.
  Use MediaRecorder capability detection and a supported MIME. Show requesting,
  recording, stopping, ready and failure states; never imply recording began while
  permission is pending. No microphone monitoring by default.
- One recorder per origin uses a browser lock. Release microphone tracks and locks
  on stop, cancellation, errors and page exit. Cancelling a pending permission
  request invalidates late grants and stops their tracks. Song navigation stops
  capture; the recoverable capture remains bound to its original song/anchor.
- Persist ordered encoded chunks as they arrive (nominal one-second timeslice),
  with capture identity, original song/placement intent, MIME and state. Stop waits
  for final data and persistence before declaring readiness. Save failures retain
  in-memory data for retry and show that durability is incomplete.
- Recover interrupted captures from persisted chunks explicitly; never steal an
  active recording in another tab. A process kill can lose the most recent
  unpersisted chunk. Concatenate stored chunks before decoding; incomplete codec
  output may be recoverable only as a raw download. Keep failures visible and
  preserve bytes for retry/export rather than discarding them.
- Bound a take to 10 minutes and each encoded asset to 25 MiB. Exceeding limits
  stops capture and preserves available data with an explicit result. These are
  prototype memory limits, not silent truncation of a supposedly complete take.

### 6.3 Portable bundles and useful playback

Use a versioned `.songbundle.json`: canonical song plus one base64 record per
referenced asset. It is readable and requires no archive dependency. Validate
schema, identity, bytes, decoded duration, completeness and bounds before changing
the song. Limit bundles to 50 MiB encoded audio (base64 overhead additional).
Import keeps ID-conflict/copy and revision policies; staging verified assets before
song commit is safe because failed commits leave a recoverable library entry.
Export fails explicitly if any referenced media is absent/corrupt; never produce
a bundle presented as complete while omitting audio. Plain `.song.json` exports
metadata only and must say so; importing it reports missing media.

Schedule decoded take buffers on the existing audio clock, respecting absolute
starts, trims, section repeats, gain/mute and seek offsets. Stop/seek/song changes
cancel both synthesized and recorded sources. Decode/loading failure prevents a
misleading partial audition; report missing/unsupported media. Keep independent
musical releases. No recording auto-alignment, time-stretch or DAW mixing is implied.

Improve instrumental audition with a decaying harmonic guitar pluck, a fuller
bass tone, noise-based snare/hat and a pitched kick, all locally synthesized with
no licensed samples or network fetch. Preserve scheduler observability, bounded
source cleanup and existing metronome behavior. Voice notes have a simple sustained
tone; recorded vocal takes provide the real captured voice.

### 6.4 UI, tools, validation and exit gate

Provide ordinary capture/import/library/attach controls, editable take trim,
scope, gain and mute, recovery/download/delete controls and complete bundle
import/export. Show missing assets and recorded-key behavior; make take placement
visible alongside the song timeline. Keep capture/file/draft state across failed
attachment and reject stale revisions. Tools expose import/export bytes, media
status/library, recording lifecycle, recovery, and shared take/asset CRUD. Browser
permission remains the browser's authority; no agent bypass or hidden capture.

Test migration, content identity/corruption, trims/section repeats, staged assets
on conflict, protected cleanup/undo, complete/missing bundle round trips, source
scheduling and independent note preservation. Real Chromium checks cover synthetic
microphone input, permission denial and delayed grant/cancel, final-chunk ordering,
reload recovery, cross-tab recording lock, stopping/seek and audio-graph output.
Use generated fixture audio, never private recordings. A live agent evaluation
attaches/imports media via tools, places/trims a take, exports/reimports a bundle,
and independently verifies bytes and musical preservation; simulated microphone
input is disclosed rather than described as a physical recording evaluation.

Run frozen install, `bun run verify`, all browser workflows and whitespace checks.
Publish a phase6 PR, resolve failures, verify its final GitHub commit, merge and
record `docs/PHASE6_VALIDATION.md` before expanding Phase 7. No remote backup,
transcription, studio processing, streaming service integration or sample library.

## Phase 7 — Extended agent workflows and user customization

**Status:** DONE — local checks, live agent evaluation and GitHub verification passed.
Evidence: [Phase 7 validation](docs/PHASE7_VALIDATION.md). Phases 8–9 remain planned.

### 7.1 Portable writing instructions and reusable prompts

Schema 7 adds `writing` metadata for project instructions and songwriting preferences,
and a `prompts` table of reusable named prompts with stable IDs. These belong to the song,
travel in JSON/media bundles, and are revision-checked, reviewed and undoable
through the same command path as music. Migrate schemas 1–6 and history without
changing receipt identity. No database reset or new dependency is required.

Provide ordinary editors for instructions/preferences and prompt create/read/
update/delete. Preserve dirty drafts on incoming changes. A saved prompt can fill
the request editor for customization before submission; it does not automatically
start a task. Provide a few editable starting recipes based on workflows already
exercised: develop an independent variation while preserving bass, inspect playable
positions, and review recorded take placement. Recipes describe outcomes, not
hard-coded editing procedures. General atomic document edits remain available.

Keep preferences as writing guidance, not authoritative musical data or permission
to override the user's task. Imported song content and lyrics are data. Task
creation snapshots the instructions/preferences, source revision and selected
prompt text; later customization must be visible in history and must not silently
rewrite an already-running task. Workers can inspect both snapshot and live context.
Bounds: instructions 8,000 characters, preferences 4,000, at most 32 saved prompts,
8,000 characters each. Reuse across songs through portable writing JSON import/export.

### 7.2 Bounded context and inspectable changes

Context defaults to small summaries with counts, explicit pagination and revision
identity: songs, sections, harmonic regions, takes, recent history, selection,
transport and available capabilities. Show prompt names/IDs instead of all prompt
bodies. Add bounded entity search and receipt detail queries. Retain explicit
full-document/range reads and binary export for tasks that need them; don't feed
large song snapshots or media bytes into the default task/status view.

Pagination accepts expected song/revision and rejects stale continuation so a
concurrent edit cannot silently skip objects. Cap pages at 50 entries; bound label
lengths and affected-object summaries. Expose totals and continuation offsets.
The agent can refresh summaries, inspect an object or receipt, then request the
next page. Completion must not infer that a truncated result is the whole song.

### 7.3 Durable task progress and bounded continuation

Keep the existing local external-agent host, with no provider key in the browser.
Extract task persistence/control into a serial durable store that acknowledges
changes only after atomic file replacement. A failed write must not expose an
uncommitted task transition or poison future persistence. Load legacy task records
additively; corrupt state is an explicit startup failure rather than erased work.

Add revisioned checkpoints with a concise summary, next step and up to 50 work
items (`pending`, `in_progress`, `completed`, `failed`, `skipped`). Preserve them
through bridge restart, browser reload, cancellation and resume. Explicit completion
rejects unfinished items and outstanding tool calls; partial/waiting/failed remain
valid outcomes. No heuristic completion and no hidden reasoning transcript.

Bound each execution segment to 100 new tool calls and 15 minutes. Reaching a
limit moves the task to waiting with progress retained. Explicit resume opens a
new segment, up to 1,000 total calls per task. The host's model token/cost budgets
remain its responsibility. Resume requires a newly delivered live `context` result
before further edits; old checkpoints never authorize stale writes. Stable step
identity rejects mismatched retries, and durable musical operation IDs prevent
duplicate edits after response loss. Update task song binding only after explicit
open/create/import actions so later tools address the intended workspace.

Expose task inspection, checkpoint and explicit finish through the authenticated
CLI. Return bounded task/step summaries for ordinary status polling, with detailed
step results requested individually. Show provider/model, progress, errors, current
segment, context-refresh need and durable changed operation IDs in the editor.
Allow reviewing actual before/after deltas and undoing an individual task change
through the existing conflict-aware history path. Cancellation leaves committed
music visible and recoverable; it cannot undo an already executing tool silently.

### 7.4 Acceptance and exit gate

Test writing migration/validation/CRUD/undo/portability and stale drafts; context
bounds/search/pagination conflicts; task persistence failure/restart, checkpoint
conflicts, segment limits, resume refresh, mismatched step retries and explicit
completion. Browser tests exercise ordinary prompt editing/use, snapshots, task
progress/change review and interrupted collaboration with another editing tab.
Retain all prior musical, capture, audio and delivery-retry regressions.

Run a live agent task combining primitives in a new way: use customized project
instructions to develop a variation, preserve held voices and recorded media,
checkpoint partial work, accept an intervening writer change, refresh context on
resume, inspect/reconcile durable operations and complete without duplicate edits.
Independently verify the resulting music and checkpoint evidence. Disclose scripted
fault injection separately from live model decisions and real browser execution.

Run frozen install, `bun run verify`, all browser tests and whitespace checks.
Publish a phase7 PR, verify its final GitHub commit and merge. Record evidence and
limits in docs/PHASE7_VALIDATION.md. No autonomous self-rewriting code, hosted model
SDK migration, remote sync or mobile release claims are included.
