# UI / agent capability map — Phases 1 and 2

All mutations below use the same revision-checked `mutate` interface and durable
command path as the editor. Every table supports read/create/update/delete;
structural dependencies may require an atomic multi-object edit.

| UI outcome | Agent equivalent |
| --- | --- |
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
| Create a pattern variation | Compose pattern/event creation and occurrence edits |
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
and live external-agent compositions through these primitives. Media, advanced
guitar notation, and user prompt customization remain later phases.
