# Songwriting app — product and technical plan

Status: planning only. `songwriting` is a working name.

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
