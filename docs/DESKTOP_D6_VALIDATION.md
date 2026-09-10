# Desktop D6 — Responsiveness and lifecycle

Status: slices 6a–6b implemented and merged (PRs #39, #40); 6c is this
document plus the keyboard/accessibility audit below. D6 is complete subject
to the hardware remainder, which needs physical devices and a packaged app.

## Delivered slices

- **Performance bed and tripwires (6a):** new `song-testkit` crate with
  deterministic in-test generators (no checked-in blobs): reference (32
  parts, 1,024 mixed-meter bars, 64 patterns, 10,048 events), stress (100
  patterns × 500 events, global occurrences, 50,000 events) and
  audition-scale (16 bars, 200 short notes, ~27 voice-seconds, inside the
  render budget). Entity cap raised 20,000 → 100,000 in `validate.ts` and
  `validate.rs` together (the stress project needs it; it stays an explicit
  bound). Budgets are tripwires at 30–100× above droplet debug measurements,
  never tuned to fit:

  | Check | Droplet debug | Budget |
  |---|---|---|
  | reference accept worst-of-5 | 202 ms | 10 s |
  | reference `sounds()` | 598 ms | 30 s |
  | stress `sounds()` | 2,669 ms | 90 s |
  | audition compile (232 tones) | 2 ms | 10 s |
  | audition render (1.6M frames) | 495 ms | 30 s |

- **Continuity and lifecycle (6b):** full audition playback on a
  null-capable output while a CPU-saturating sibling thread expands the
  reference song for the whole window (flag stays set until `ended` is
  observed, so the load is alive throughout by construction). Asserts
  monotonic frames, `ended` with frames == total, callbacks > 0. Droplet
  null sink: 1,645,714 frames, 400–700 callbacks, 0 xruns. Play → stop →
  replay proves stream teardown/reopen; engine close rejects intents and a
  fresh engine starts stopped. Device tests skip loudly where no audio
  stack exists. Session close/reopen (revision preserved, epoch rotated,
  stale sessions rejected, queued edits drained) was already covered by the
  session tests and is cited, not duplicated.

## Boundaries found (all pinned by tests)

- Native audition is explicitly audition-scale: 600-second schedule ceiling,
  120 voice-second render budget, 65,536 tones. Reference-scale compile
  refuses `audio_limit`, stress compiles (50k tones) but render refuses
  `audio_limit`. Long-form or dense-song playback beyond these bounds is a
  product decision, not a bug.
- Null devices drain as fast as callbacks fire (no realtime pacing), so
  null-device runs prove scheduling liveness and lifecycle, never device
  timing or dropout behavior. That proof needs hardware with real outputs.
- A first version of the continuity test asserted the burn thread was still
  inside fixed work at end of playback; macOS CI (fast CPU, realtime-paced
  output) finished the work first and failed it. The load is now
  window-bound instead of work-bound. Machine-relative overlap assertions
  do not survive a three-OS matrix.

## Keyboard and accessibility audit

- Every interactive element in the desktop window is a native control:
  buttons for play/stop/refresh/undo/redo/reconnect and per-note selection,
  selects for output/pattern/snap, checkbox for metronome, text inputs for
  key/start, range for zoom, form submit for applying edits.
- Note buttons carry `aria-label` (label, position, chord membership) and
  `aria-pressed` for selection; keyboard activation (`detail === 0` click)
  selects without dragging. Pointer drag has a keyboard path: the exact-start
  form plus Escape-to-cancel. No pointer-only action exists.
- Status uses `role="status"`, errors `role="alert"`, the audio section has
  `aria-label`, the level meter is a labelled `<meter>`. No `tabindex`
  hacks, no div-click handlers.
- No screen-reader run has been done; that and a packaged-app keyboard
  walkthrough are in the hardware remainder.

## Suspend/resume story (documented from the close path, not tested live)

- The engine holds no committed data: edits live in the workspace, playback
  state is disposable. `close()` releases the device; a fresh engine starts
  stopped.
- OS sleep during playback surfaces through the existing device-failure
  path (`metrics.failed` → view error "Audio device stream failed…
  Refresh outputs and press Play to retry"), i.e. automatic silence plus
  explicit retry. No resume corruption is possible by construction, but no
  live sleep/wake cycle has been exercised.

## Process notes

- CI runs clippy with `-D warnings`; the 6a PR failed all legs on three
  redundant `as i32` casts that local clippy (without the flag) stayed
  silent about. Local validation now mirrors CI exactly.
- A macOS-only `song-media` store test flaked once on a docs-only diff and
  passed on rerun (same SHA, no code change); droplet `ffmpeg` emits 768
  extra AAC padding frames versus the pinned manifest, so
  `song-media/tests/formats.rs` fails on this machine and passes under the
  pinned CI decoder. Both are environmental, recorded here so the next red
  leg is not re-diagnosed from scratch.

## Hardware remainder (needs user)

Physical-output dropout proof, live sleep/wake cycle, screen-reader run,
packaged-app keyboard walkthrough, and any render-scale claim beyond the
audition bounds above.
