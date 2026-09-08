# Abletonify the existing song view

Status: implemented 2026-09-08; local typecheck, 86 unit tests and 32 browser
workflows pass. GitHub verification gates publication/merge.
The user activated this arrangement-workspace redesign, including the relative-note
editor. It delivers the desktop visual/layout portion of Phase 8; broader
mobile/offline/reliability work remains separate. See
[validation and limitations](docs/UI_REDESIGN_VALIDATION.md).

## 1. The agreed direction

**Keep the song view we already have and give it Ableton's visual discipline.**
The song arrangement remains the main canvas. Sections, bars, harmony, phrases,
notes, independent voices and recorded takes stay together on its timeline. An
integrated lower note editor provides detailed editing using relative degrees 1–7.

The user's clarification is a firm boundary: no Session View or clip launcher.
A note editor is explicitly wanted, using non-key-specific 1–7 notation. It opens
below the arrangement, with the selected part, voice and passage clearly identified.
Patterns remain the existing reusable musical objects; editing their notes does
not introduce a new clip model or a separate performance/launching workflow.

Use Ableton Live's Arrangement View for compact transport, neutral panels, clear
track lanes, restrained region colours and economical spacing. Its manual
illustrates the linear arrangement, overview and navigation conventions used as
reference here. [Ableton Arrangement View](https://www.ableton.com/en/live-manual/12/arrangement-view/).
Our application retains its own labels, icons, musical model and songwriting tools.

This is a visual/layout redesign plus a graphical editor for the existing note
model. Retain Bun,
TypeScript, lit-html, the controller, validated commands, storage, audio engine
and agent bridge. No new framework, musical schema, sound engine or DAW feature
set is needed to deliver it.

## 2. What changes visually

The current code puts arrangement, rhythm, harmony, fretting and media workbenches
above the song map. The rendered Phase 7 example requires substantial page scrolling
to reach the music. `src/style.css` mixes large card spacing with many 8–11 px labels.
These are observations from the code and saved rendered example, not a usability study.

| Before | After | Why |
| --- | --- | --- |
| Song map below a stack of workbenches | Song map immediately below the transport | The song becomes the permanent working surface |
| Tall rounded cards and generous page margins | Flat grey panels, fine dividers and compact spacing | More visible music, closer to the requested Ableton feel |
| Light green page treatment | Neutral grey chrome and a slightly darker musical grid | Part colours and selected notes carry the visual emphasis |
| Small faint musical labels | Readable compact labels and aligned numeric values | Density should come from layout rather than tiny text |
| Workbenches permanently occupying the page | Named toolbar buttons open existing tools in a collapsible tray | Keep capabilities close without pushing away the timeline |
| Notes primarily edited through property fields | Integrated time grid with degree rows and exact property controls | Compose notes visually while keeping relative pitch explicit |
| Inspector and musical-object collection below everything | Selection inspector at the right; Objects available through an explicit drawer | Edit existing objects without a long page traversal |
| Long agent/prompt column | Right panel switches between Selection and Agent; activity remains visible when closed | The writer controls how much space the assistant occupies |
| Small screens stack full panels vertically | One auxiliary panel at a time, with persistent song/transport access | Preserve the song view rather than recreating the long page |

## 3. Target layout

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ Song ▾   Undo Redo   ▶ ■   Tempo / pulse   Hear in C   Click   Recording │
├─────────┬───────────────────────────────────────────────────┬───────────┤
│ SONGS   │ Notes  Structure  Rhythm  Harmony  Tab  Audio  ⋯   │ SELECTION │
│         │ Fit / zoom                         Agent • status │ / AGENT   │
│ Song A  ├────────┬──────────────────────────────────────────┤           │
│ Song B  │Section │ Intro          A              A′         │ Selected  │
│         │Meter   │ 7/8 · 2+2+3    9/8 · 2+2+2+3             │ object    │
│ Import  │Harmony │ I(add9)        IV             V/V        │ properties│
│         │Phrase  │ [opening phrase─────────]                │           │
│         ├────────┼──────────────────────────────────────────┤ Existing  │
│         │Guitar  │ notes, chords and repeated patterns      │ fields /  │
│         │ voice 2│ independent melody                       │ actions   │
│         │Bass    │ ━━━━━━━━━ held note ━━━━━━━━━            │           │
│         │Drums   │ existing hits and pattern cycles         │           │
│         │Voice   │       [recorded idea]                    │           │
├─────────┴────────┴──────────────────────────────────────────┴───────────┤
│ Lower tray: Notes / selected workbench — Guitar · voice 1 · passage A   │
│ Notes: octave-labelled 1–7 rows × exact musical time; ♭/♯ on each note   │
├─────────────────────────────────────────────────────────────────────────┤
│ Saved / saving / conflict       exact position       capture/task state │
└─────────────────────────────────────────────────────────────────────────┘
```

### Default state

The song map is visible immediately. The tool tray starts closed. The song list
stays at the left, and part/voice labels stay alongside the left of their lanes,
familiar from the existing view. The right inspector opens on a selection; Agent
is an explicit alternative in that same panel. A visible badge reports active,
waiting or failed tasks even when the panel is closed.

Keep section/meter/harmony headers aligned with the notes underneath. Use sticky
rulers and part labels so horizontal/vertical timeline scrolling remains legible.
The timeline owns its scrolling; opening tools does not scroll the document away
from the selected passage. Initially retain the current fit/zoom controls. A small
song overview may improve navigation, but it is not a second editing view.

### Opening the note editor and tools

`Notes` opens the degree editor for the selected pitched part/voice and passage;
an empty passage supports creating its first note. Selecting a note while Notes
is open focuses it in both views; opening Notes is also available from a note or
pattern selection. Ordinary selection alone does not force the tray open.

`Structure`, `Rhythm`, `Harmony`, `Tab` and `Audio` open their existing workbenches
in the lower tray. Only one is open at a time. The selected tool button indicates
what is open and toggles it closed. Wide comparison tables and tablature have room
here, while simple selected-object fields live in the right inspector. Do not
render duplicate editable forms for the same object in both places.

The Notes tray has a detailed time grid with the same musical positions, selection
and playhead as the arrangement. It may zoom independently for fine editing, but
uses the song transport and keeps its passage highlighted above. Other tray tabs
host their existing controls/results. Context can prefill a field only when
unambiguous; dirty fields are never replaced automatically.

`Tools` exposes named entries for Objects, Changes, Project guidance and Advanced.
Existing ordinary controls remain ordinary controls. JSON stays available for
advanced atomic editing; it is not the fallback for a capability lost in the move.

### Screen-space rules

| Viewport | Proposed behaviour |
| --- | --- |
| 1440×900 | About 48 px transport, 56 px toolbar, 24 px status; 160 px song list and 280 px right panel; tray closed by default, about 240 px when opened |
| 1366×768 | Same structure with a smaller optional tray; retain at least 300 px of song area including its pinned rulers |
| 1024×768 | Collapse the song list before compressing the song; only one auxiliary sidebar open; prefer a short tray with its own scrolling |
| Narrow screen / 200% zoom | Arrangement and Notes share the song context; the active editor/tool can temporarily occupy an auxiliary sheet with an explicit Return to song action; Play/Stop and capture status remain reachable |

Start with a 640 px minimum central song viewport for desktop layout decisions;
its part-label column sits within that budget. Collapse the song list, then the
optional right panel if needed. User-expanded panels must not squeeze the grid
into an unusable sliver. At compact widths, switch to the explicit compact layout
rather than creating whole-page horizontal overflow.

Resize handles also have keyboard controls. Clamp stored panel sizes after window
resizing, and provide Reset layout. Closing a panel retains its draft, selection,
scroll position and task/capture state. Proposed sizes must be checked in a browser
prototype before being treated as final dimensions.

## 4. Visual specification

- Start with a medium-grey transport/sidebar, slightly darker timeline background,
  subtle alternating lane shades and thin grid lines. Distinguish bar boundaries,
  beat groups and subdivisions by line weight. Check the palette in light and dark
  surroundings before finalising tokens; no requirement to ship multiple themes.
- Use a restrained stable colour per part. Guitar voices share a colour family;
  their names and separate lanes distinguish them. A held bass remains visible
  across boundaries. Avoid assigning unrelated meanings to the same colour.
- Selection uses a high-contrast outline and a clear selected-object label. Preview
  uses a distinct outline/ghost treatment. Errors use an icon and text as well as
  colour. Muted parts remain readable. Recording has an unmistakable active state.
- Begin with 13 px interface text and 12 px musical labels, tabular numerals for
  timing and sensible text scaling. Essential labels must not require 8–9 px text.
  Compact desktop controls can be about 28–32 px high; provide larger touch targets
  in compact/touch layouts. Preserve full names through accessible labels and detail.
- Remove large marketing-style headings, explanatory slogans, oversized cards and
  generous blank margins from the working surface. Keep useful instructions in
  empty states and contextual help.
- Use crisp rectangular controls with modest corner radii and consistent states.
  Avoid decorative movement. Keyboard actions, selection and timeline navigation
  should be immediate; occasional drawers may use short transitions that respect
  reduced motion. No new animation dependency.

## 5. Preserve the songwriting behaviour

The redesign must make existing information easier to read without changing its
meaning. The degree editor is another view of the same stored musical objects.

- Meter remains per bar, including odd/compound signatures, grouping, pickups and
  shorter actual durations. Width follows exact time: a 7/8 bar and a 9/8 bar are
  not equally long. Pattern cycles do not restart at bar lines.
- Notes remain relative degrees with alterations and octaves. Chords contain
  individually identifiable notes and member performances. The degree editor and
  exact inspector edit those same objects; Roman numerals describe chord function,
  while Arabic numerals 1–7 label individual note degrees.
- Harmony shows authored labels/context with clear scope. Analysis of sounding
  notes remains distinguishable from authored chord intention. Concurrent voices
  may imply more than one interpretation; do not force a single chord progression.
  Empty harmony stays empty, with the existing add/edit actions available.
- Part, voice, pattern, occurrence and section appearance remain distinct. A
  pattern selection identifies its source and shared usages. Make variation stays
  an explicit action. If the selected rendered occurrence repeats, retain enough
  view context to highlight the correct appearance without changing song storage.
- Phrases, lyrics, rests, held voices and cross-boundary releases remain visible.
  Pattern regions retain their cycle/start/span meaning; they are not converted
  into a new clip entity or a one-region-at-a-time playback restriction.
- Existing tuning/capo, fingering and technique diagnostics remain available through
  Tab. Audio retains its exact musical anchor and trim in seconds, recorded key,
  original bytes, missing-media state, recovery and complete-bundle behavior.
- Preserve exact fields, existing nudges, shared command validation, operation
  identity, source-preserving transformations and undo. Note-editor gestures and
  snap are specified below; loop transport, solo/mixer semantics and audio warping
  remain outside this redesign. Only ship controls backed by functioning commands.

Clicking the song continues to select rather than changing playback or music.
Fields and previews retain their base revision. Agent/other-tab edits mark a dirty
form stale without replacing its contents. Selecting another object or closing a
tray must not discard a draft. Show which saved object each retained draft belongs
to; a deleted object's draft remains copyable instead of silently disappearing.

### Relative-degree note editor

- Use a piano-roll-like time grid with **1, 2, 3, 4, 5, 6, 7** as the vertical
  axis, repeated by octave. Label octave bands explicitly. Do not substitute a
  C–B keyboard or black/white piano keys. Horizontal position and length represent
  exact musical onset and duration, with the selected passage's bars and grouping.
- Keep the stored major-scale reference: degree, alteration and octave determine
  relative pitch. Changing “Hear in” transposes audition without relabelling or
  rewriting degrees. A mode/context change does not silently remap existing notes.
- Display alterations directly on note blocks (for example ♭3, ♯4, ♭7), with
  explicit alteration and octave controls. Seven principal lanes remain readable;
  simultaneous differently altered notes on one degree use labelled sublanes so
  neither is hidden. Preserve the authored spelling of ♯1 versus ♭2. Moving a note
  between degree rows preserves its alteration unless the writer changes it.
- Support select, add, move, resize and delete, plus multi-selection and explicit
  chord-member editing. Selection mode remains the default; an explicit Draw mode
  creates notes. Provide keyboard actions and exact onset/duration/pitch fields
  for every pointer gesture. Escape cancels a gesture; committing one gesture is
  one undoable command operation, not a stream of saved pointer positions.
- Snap uses exact rational musical durations, including tuplets, with the current
  increment visible and an exact custom increment available. Calculate from
  musical time, never rounded pixels or floating-point seconds. Snap subdivision
  guides follow the passage's meter/grouping; durations may cross bars and cycles.
  Unsnapped positioning still resolves through the existing exact-time model;
  exact fields remain authoritative for values beyond the displayed resolution.
- Show the selected voice prominently; other voices can appear as labelled ghosts
  and require explicit selection before editing. A chord's notes remain individually
  identifiable members. Simultaneous independent notes do not automatically become
  a chord; provide an explicit chord/member action. Render individual member attack
  and release where performances differ; do not resize all members unintentionally.
- The header identifies the source pattern and selected arrangement appearance.
  Warn that source edits affect shared usages, and keep Make variation next to that
  scope indicator. Repeated renderings point to the same source identities; visual
  duplication must not become duplicate stored notes. Independent cycles and notes
  sustained beyond the visible passage stay legible without truncating stored time.
- Use the shared validated command path, revision checks and receipts. A concurrent
  agent edit cannot silently overwrite a gesture or draft based on an older revision;
  retain the proposed edit for review/retry. Update the capability audit for new
  editing outcomes, keeping them available to agent tools. Keep geometry, zoom,
  selection and gesture previews in view state rather than the canonical song.
- Drums keep named hit lanes and audio keeps take/waveform controls. The 1–7 editor
  applies to pitched notes, including composed vocal melodies; it does not convert
  recorded audio into invented note data.

## 6. Every current capability has a home

Audit every row in `docs/CAPABILITIES.md` during implementation. This family map
is the starting point; the detailed inventory is the authoritative coverage list.

| Existing capability family | Redesigned destination |
| --- | --- |
| Song create/open/delete/restore; JSON and media bundle import/export | Song list and Song menu |
| Object CRUD, exact properties, advanced atomic document edits | Objects drawer, Selection inspector and Advanced |
| Sections, bars, repeats/order/variation, local/global placements | Main song structure lanes and Structure tray |
| Notes, chords, member attacks/releases, expression, voice identity | Notes degree editor and exact Selection fields; Harmony tray for harmonic context |
| Rhythm transforms, grouping, phase, polyrhythm, alignment and comparison | Rhythm tray; results highlight the existing song map |
| Harmonic context, interpretations, sounding harmony and voice leading | Existing harmony lanes and Harmony tray |
| Fretted arrangements, position assignment, tuning/capo and diagnostics | Tab tray; selected notes stay highlighted in the song |
| Phrases, lyric text and phrase/part links | Main song guides and Selection inspector |
| Capture, takes, import/attach, recovery, raw download, cleanup and bundles | Audio tray; persistent capture state in transport/status |
| Instructions, preferences, prompt CRUD/use and guidance transfer | Project guidance / Agent panel |
| Tasks, checkpoints, resume/cancel, receipt review and undo | Agent panel and Changes drawer |
| Tempo and beat unit, audition key, metronome, play/stop/seek | Persistent transport |
| Fit/zoom/selection, save errors, incoming changes and undo/redo | Song toolbar, status and Changes |

A primary songwriting tool should open with one named toolbar action. Existing
selected-note/chord fields should need no navigation away from the song. Deep
functions can remain in their existing workbench groups; a command palette or
context menu must not become their only entry point.

Recording and task controls need special care: closing their panel does not stop
work, cancel permission, discard audio or imply a successful save. Show requesting,
recording, stopping, ready and failure accurately. Stop/cancel and task recovery
remain reachable. Clicking an agent change may reveal its passage only on explicit
user action; incoming edits must not steal focus, scroll or the current tool.

## 7. Implementation order

This is the selected redesign workstream, not activation of all Phase 8 work.
Each step should preserve a usable app and keep the existing domain/tool paths.

| Step | Work | Exit gate |
| --- | --- | --- |
| R1 — Visual layout prototype | Show the CURRENT song map with the proposed chrome, tool tray and side panel at desktop/compact sizes; use real acceptance-song content | Looks recognisably Ableton-inspired; song visible on first screen; integrated 1–7 editor mockup fits below song; no Session/launcher view; confirm panel-fit budgets |
| R2 — Shell and styling | Move transport/status/song map into the fixed workspace; introduce palette/spacing/type tokens; retain lane labels and current interactions | Existing composition/playback/save workflows pass; no document scroll needed to find the song |
| R3 — Relocate existing tools | Mount existing workbenches in the tray, inspector in the side panel, object/history/project tools in named drawers | Every capability has a reachable destination; drafts survive closing/switching tools; no duplicated editable forms |
| R4 — Relative-degree note editor | Implement degree/octave rows, alteration labels, note/chord-member selection, exact-time draw/move/resize and keyboard/field alternatives through shared commands | Notes stay relative across audition keys; shared-source scope is explicit; exact timing, member identities, undo and stale edits pass focused checks |
| R5 — Musical readability and state | Align/stick rulers and labels, improve event/chord/meter/phrase/voice rendering, selection scope and warning/status treatments | Odd meters, relative harmony, independent cycles and held voices remain accurate and legible; agent/capture states always discoverable |
| R6 — Validate and finish | Keyboard/touch alternatives, resizing, compact layout, contrast, visual regressions, workflow regression and performance checks | Capability audit and acceptance journeys pass; final GitHub checks pass before merge |

Main files are `src/app/view.ts`, `src/style.css`, and existing modules under
`src/app/` for arrangement, rhythm, harmony, fretting, lyrics, media, writing and
tasks. Add a focused note-editor module; extract shell, tool-tray host and status
composition as needed; avoid turning
`view.ts` into a larger conditional template. Keep one controller and one musical
mutation path. Domain/storage/audio changes need a demonstrated redesign requirement,
not an opportunity to rewrite working code.

Panel geometry, active tool, collapse state and view density are local view state,
not song data. Reuse the settings store for bounded/versioned preferences. Draft
state must outlive panel mounting. Keep controller/recording/bridge lifecycles owned
by the app, never by a collapsible view. Navigation alone must not dirty the song.

## 8. Validation and completion criteria

Use the existing acceptance songs: `crossing-lines`, `turning-rooms`,
`capo-conversations` and `echoes-with-room`. No fabricated example harmony may be
presented as saved music. Capture screenshots of the same song and selection before
and after so improvements in visible music and readability can actually be judged.

Walk through these workflows in the arrangement and its integrated tools:

1. Create a song with guitar/bass/drums/voice; add 7/8 and 9/8 bars, a relative
   chord and melody, then audition without JSON.
2. Arrange A–B–A′, shorten only the reply, keep a held bass and inspect alignment;
   undo while the affected passage remains visible.
3. Edit an extended/applied chord and independent member releases; inspect its
   interpretation and the actually sounding voices.
4. Retune/capo a guitar, expose incompatible fingerings and repair positions while
   keeping relative notes unchanged.
5. Import/record, attach/trim, repeat a take's section, recover interrupted audio,
   and export/import all media with clear recording/save state.
6. Keep a lyric draft while an agent changes the song; close/reopen the tray,
   review the change, resolve the stale draft and resume the task.
7. In Notes, draw 1, 3, 5 and ♭7 across two octaves, move and resize with tuplet
   snap and exact fields, then change the audition key: stored degrees and labels
   stay unchanged. Verify ♯1/♭2 spelling, overlapping alterations, keyboard-only
   editing, chord-member identity and independent releases.
8. Edit a repeated pattern through a chosen appearance, verify the shared-source
   indication, then Make variation and edit only that variation. Undo a complete
   gesture; introduce a concurrent agent edit and verify conflict recovery preserves
   both the saved change and the writer's proposed edit.
9. Exercise prompt/guidance editing, object CRUD, deleted-song restore, exact
   properties and all remaining capability-map rows after moving their controls.

Check 1440×900, 1366×768, 1024×768 and 390×844 layouts, including 200% zoom,
keyboard-only use, touch alternatives, long names, empty song/selection, dense
music, missing media, active capture, disconnected agent and stale preview.
Measure contrast; target 4.5:1 ordinary text and 3:1 essential control/focus
boundaries. Do not rely on colour alone or a screenshot for accessibility evidence.

For performance, record the browser/hardware and compare the same fixture before
and after (for example 16 parts, 64 appearances and 5,000 events). Confirm selection
feels immediate and pan/zoom does not repeatedly block the main thread. A target
of visible selection feedback within 100 ms and no repeated >50 ms pan stalls is
an implementation target to measure, not a current performance claim. Avoid
rebuilding full song geometry for a tray toggle or rescheduling audio on layout edits.

Implementation checks: `bun run verify`, focused and full browser workflows,
`git diff --check`, and GitHub verification before merging. Preserve semantic tests
when selectors/layout change; add visual assertions rather than replacing exact
music, media, conflict and retry checks. Record physical-device checks separately.
The implementation carries both musical command tests and browser workflows.

Completion means: the existing song view looks and feels like a compact Ableton-
inspired workstation; the music remains visible; all current songwriting tools
are accessible; the integrated 1–7 note editor works without key-specific pitch
labels or a Session/clip-launcher view; and behaviour has regression evidence. The implemented prototype and screenshots are reviewed in the validation record;
this is not a claim of physical-device testing or a usability study.

## 9. Refinement record

1. **Musical correctness pass:** audited shared patterns, repeated appearances,
   mixed meters, independent voices and authored versus sounding harmony. Kept
   those distinctions explicit in selection and display requirements.
2. **User scope correction:** “only the song view” excludes Session/clip launching.
   The initial revision removed too much; the latest clarification explicitly wants
   a note editor using non-key-specific 1–7 notation. Restored that integrated lower
   editor, specified alterations/octaves and exact-time interaction, and retained
   the existing arrangement, song list, lane labels and workbench capabilities.
3. **Access and screen-fit pass:** checked where each feature moves and whether
   auxiliary panels displace the song. Added one named action per primary tool,
   a closed-by-default tray, sidebar collapse priority, minimum song-area budgets,
   explicit compact behaviour and a full capability-family map.
4. **Implementation/regression pass:** separated style/layout changes from domain
   changes; specified draft retention and app-owned recording/agent lifecycles.
   Organised delivery into six bounded steps and tied completion to the existing
   musical acceptance journeys, visual comparisons and regression checks.

Stop condition for this planning loop: no remaining conflict with the user's
arrangement-plus-degree-editor scope, no capability family without a destination,
and every proposed editing control mapped to the shared musical model and command
path. The implemented prototype, browser checks and dense-song measurements are
recorded in docs/UI_REDESIGN_VALIDATION.md, including remaining device and
performance limits.
