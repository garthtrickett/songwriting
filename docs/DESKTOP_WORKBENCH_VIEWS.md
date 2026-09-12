# Desktop workbench views — projecting the ported model into the window

Status: implemented, 2026-09-12. This closes the read-path and panel gap between
the desktop window and the browser workspace. It does not activate D4, D5 or D7,
and it does not claim a phase is complete.

## What the gap actually was

D2 ported the musical model, actions and analysis to Rust, and D3 added native
playback. The window did not show most of it. The measured gap was:

| | before | after |
| --- | --- | --- |
| Snapshot tables reaching the view | 4 of 19 | 19 of 19 |
| Workbench panels | arrangement, notes | + song map, objects, harmony, rhythm, tab, writing, takes |
| Action kinds reachable from the UI | rename, moveNote, undo | + structure, rhythm, harmony, generic table/meta edit |

The write path was already complete: `Action` has carried `structure`, `rhythm`,
`harmony`, `edit`, `replace` and `delete` since D2. Nothing in the UI called
them, and the projection dropped fifteen tables on the floor, so the panels that
would have used them could not be written.

## Read path

`protocol::Library` groups the projected tables behind one `Snapshot` field.
That is deliberate: two constructors build a `Snapshot` (normal and
deleted-song), and a flat field per table would let a new view be added to one
and silently forgotten in the other. `deleted_song_clears_the_library` asserts
the deleted path cannot leak the previous song's rows.

Names are resolved in `projection::library` rather than in the view, so a panel
never joins tables and every row stays traceable to accepted state. Arranged
expansions reuse the existing core functions (`section_spans`, `annotations`,
`take_placements`) instead of reimplementing them next to the view.

## Rendering bounds

`wire.ts` validates the library on arrival like the rest of the snapshot. The
arranged collections are bounded by the Rust projection's own caps (100000
annotations, 10000 takes) rather than the 20000 object-table bound: a tighter
limit would reject a legitimately large song outright and leave the writer
looking at a transport error instead of their music.

## Evidence

| Check | Result |
| --- | --- |
| `projection::tests` (5) | PASS: every arranged table projected, foreign keys resolved, deleted song cleared, budget held |
| library projection budget | 19ms on the annotated reference song (32 sections x 64 annotations); budget 1s, ~50x, matching the song-core margin |
| `client.test.ts` library cases (3) | PASS, and all three fail if the validator is removed |
| `bun run check` / `bun test src` | PASS: 112 tests |
| `check-desktop-imports` | PASS: 93 modules, no `src/song` or `src/app` |
| `check-bindings` | PASS: 16 generated contracts current |
| `cargo fmt` / `clippy -D warnings` | PASS |
| `cargo test --workspace --no-fail-fast` | PASS except the pre-existing `song-media` format case below |

### Driven against the real window

`WebKitWebDriver` against the packaged debug binary, same harness approach as
`native-smoke.py`:

- all seven workbench tabs open and render their panel
- `Repeat` (structure) — revision 0 to 1, song map grows 1 to 2 appearances
- move earlier (structure) — revision 1 to 2
- `Mute` (generic `edit` on the `parts` table) — revision 2 to 3, control reads `Muted`
- `Undo · Mute Guitar` — revision 3 to 4, control returns to `Mute`

The disabled move-up control on the first row is correct, not a defect: the
first driver attempt failed because it clicked the first match rather than the
first enabled one.

### Known environment failure, not a regression

`song-media --test formats` fails on `generated-aac.m4a` (58368 frames decoded,
57600 recorded). The fixture's SHA-256 still matches, so the input did not
change: the decoder did. `resolve_decoder` prefers `SONGWRITER_FFMPEG`, then the
staged sidecar, then `PATH`, and on this droplet it reaches `/usr/bin/ffmpeg`
6.1.1 while the expectations were recorded against the pinned FFmpeg 9.0.1 from
`nix/ffmpeg.nix`, whose store path is no longer present. The 768-frame delta is
AAC encoder-delay handling between those versions. This failure is identical
before and after this work.

## Not covered

- Parameterized analysis is still not on the desktop wire: harmonic context and
  interpretations, alignment maps, polyrhythm grids, pattern comparison,
  rendered tablature and fret positions all exist in `song-core` but need a
  read-only query command to reach a panel. The tab panel says so in place of
  inventing a tablature.
- Recording and take placement remain D4; the takes panel is read-only.
- Agent task review remains D5.
- The starter fixture fills 4 of 19 tables, so several panels correctly render
  as empty on a new sketch. Panels were verified against the richer
  `tests/desktop/analysis.json` cohort.
