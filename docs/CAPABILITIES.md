# UI / agent capability map — Phases 1–7

All mutations below use the same revision-checked `mutate` interface and durable
command path as the editor. Every table supports read/create/update/delete;
structural dependencies may require an atomic multi-object edit.

| UI outcome | Agent equivalent |
| --- | --- |
| Create/edit/delete tuning, capo and absolute-key realisations | Full `fretted` CRUD |
| Find every in-range string/fret for a placed note/member | `fret_positions` |
| Assign/edit/delete positions and playing techniques | Full `fingerings` CRUD through `preview` / `mutate` |
| Read exact timed tab, stale positions and sustained-string conflicts | `tablature` with arrangement and exact range |
| Match audition key to an arrangement | `transport` settings with arrangement tonic (audition range MIDI 12–96) |
| Build an applied/extended/altered chord and optionally assign it | `preview` / `mutate` harmony `build`; `schema.harmonyRecipe` |
| Transpose a pattern without changing shared source chords | Harmony `transpose`; independent rhythm `variation` when needed |
| Compare and apply bounded octave voice leading | `voice_leading`; harmony `voiceLead` |
| Order member attacks, edit their durations/gain/articulation | Harmony `perform`; full event `performance` edits |
| Ramp selected accents, set articulation and scale releases | Harmony `expression` |
| Add/edit/delete timed global/section harmonic regions | Full `harmony` entity CRUD; `context` lists arranged regions |
| Inspect the active relative tonic/mode at exact time | `harmonic_context` |
| Inspect chord alternatives and explicitly adopt a label | `chord_candidates`; chord `label` / `labelTonic` edit |
| Inspect actual audible harmony across independent voices | `sounding_harmony` |
| Displace an entrance, shift phase, rotate attacks/accents, scale or splice time | `preview` then `mutate` with `kind: "rhythm"`; `schema.rhythmActions` |
| Build/edit/delete a declared polyrhythm and its ordinary music | Rhythm `polyrhythm` generator; full `polyrhythms` CRUD; independent event edits |
| Inspect expected versus actual polyrhythm attacks | `polyrhythm_grid` |
| Edit independent pattern grouping | `mutate` pattern `groups` |
| Compare A / A′ notes, timing, accents and performance | `compare_patterns` with source/variation pattern IDs |
| Map 2–8 cycles over a range and mark any shared start | `alignments`, then marker creation through `mutate` |
| Repeat, move, remove an appearance; independent section variation | `preview` then `mutate` with `kind: "structure"`; templates in `schema.structuralActions` |
| Attach a fitting global placement to a section appearance | `mutate` structure `attach` with appearance/placement IDs |
| Add/edit/delete phrases and lyrics, phrase/part links | `mutate` entity changes; `read` includes arranged annotations |
| Zoom, fit and jump to a section | `navigate` with zoom and/or appearance ID |
| Nudge a selected note/placement | `select` then `mutate` exact start time |
| Review shared section/pattern use and affected objects | `context`, `read`, `preview`, history deltas |
| Create/open/list songs | `create_song`, `open_song`, `context` |
| Inspect/select objects | `read`, `select`, `context` |
| Add/edit/delete parts, voices, patterns, notes/events, chords and members | `mutate` entity changes; `read` |
| Add/edit/delete sections, bars, and arrangement occurrences; order bars/sections | `mutate` related entities and `meta.arrangementOrder` |
| Place/edit/remove pattern occurrences, phase and boundaries | `mutate` occurrence changes |
| Independent pattern variation with copied chords and retained event origins | `mutate` rhythm `variation`; primitives remain available |
| Add/edit/remove markers | `mutate` marker changes |
| Compare cycles and mark an alignment | `alignment` followed by marker creation |
| Rename song, change tempo/pulse, edit mode/document | `mutate` metadata or validated document replacement |
| Read exact properties/document | `read`, `export`, `schema` |
| Undo/redo or restore a deleted song | `mutate` with `undo` targeting its change receipt; undo the undo to redo |
| Delete a song | `mutate` with `delete` |
| Import/export a song | `import`, `export` |
| Play/stop/seek, choose playback key, toggle metronome | `transport` |

The browser-only file picker/download and audio activation gesture are delivery
mechanisms. Tools receive/provide the same JSON and control the same audio engine.

Acceptance evidence: model/command invariants, browser manual and tool tests,
and live external-agent compositions through these primitives. Writing customization and task continuation are covered below.

## Phase 6 media

| Writer outcome | Shared tool path |
| --- | --- |
| Import/inspect/download audio library | `media_import`, `media_status`, `media_asset` |
| Attach a reviewed audio idea | `media_attach` with expected revision and operation ID |
| Read/edit/delete takes and asset metadata | `read`, `mutate` full entity CRUD; take inspector |
| Record, stop, cancel pending permission | `recording_start`, `recording_stop`, `media_status` |
| Recover/download/discard capture | `capture_recover`, `capture_export`, `capture_discard` |
| Remove unreferenced local binary | `media_remove_unused` with history/capture protection |
| Complete media bundle import/export | `bundle_import`, `bundle_export` |
| Audition/seek recorded and synthesized parts | Existing `transport` |

Microphone permission is enforced by the browser. Recording start returns a
requesting state; query status before claiming capture began. Asset deletion is
separate from musical deletion and never silently removes undo dependencies.

## Phase 7 writing and task workflows

| Writer outcome | Shared tool/host path |
| --- | --- |
| Edit project instructions and writing preferences | `mutate` metadata `writing` |
| Create/read/update/delete reusable prompts | Full `prompts` CRUD through `mutate` / `read` |
| Use and customize a starting recipe | `prompt_recipes`, then normal prompt edits/task objective |
| Reuse guidance in another song | `writing_export`, `writing_import` |
| Inspect bounded summaries, search objects, inspect a change | `context`, `search`, `read`, `receipt` |
| Inspect task guidance/progress/checkpoint | CLI `task`; bridge `/task_info` |
| Save progress and explicit completion | CLI `checkpoint` / `finish` |
| Cancel/resume interrupted work | Existing task controls; new claim then fresh `context` |
| Review/undo one agent change | Durable receipt detail and existing `mutate` undo |

Task controls are orchestration, not musical edits. Every editable musical or
writing entity still uses the same validated command model. Saved prompt use fills
a request for the writer to adapt; it does not start an unsolicited task.
