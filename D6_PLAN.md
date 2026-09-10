# D6 — Desktop responsiveness and lifecycle

Active as of 2026-09-10 by operator selection, alongside D3. Closes the loop
the other phases leave open: measured behavior under load, not just passing
checks. D4–D5 and D7 remain planned and unactivated.

## Outcome

Reference and stress projects exercise the full stack within documented
budgets; audio playback continues through control-plane stalls; suspend and
resume cycles lose nothing committed; keyboard operation and accessibility
claims are audited rather than assumed.

## Starting inventory

- The audio path is already stall-proof by construction: offline render,
  generation fence, copying cursor with no locks/allocations in the callback.
  Proven headless on this droplet via an ALSA null device (full playback,
  thousands of callbacks, zero xruns).
- Session close drains accepted edits; reopen restores; profile switches
  fence epochs. No dedicated suspend/resume, keyboard-audit or perf-budget
  coverage exists yet.

## Slices

1. **Reference and stress projects.** Deterministic in-test generators (no
   checked-in blobs): a reference project (32 parts, 1,024 mixed-meter bars,
   10,000 events) and a stress project (50,000 events). Perf budgets for
   command acceptance, timeline expansion, schedule compile and offline
   render, set from droplet measurements with wide CI margins. Budgets catch
   hundred-fold regressions; they are tripwires, not benchmarks.
2. **Audio continuity under load.** Real playback through a null device where
   available (graceful skip where no audio stack exists): frames advance
   monotonically to completion while the control plane burns CPU, stop/start
   cycles stay fenced, and device-failure surfaces keep working.
3. **Lifecycle, keyboard and accessibility.** Engine close/reopen and session
   reopen cycles; suspend/resume behavior documented from the close path;
   keyboard operability and accessibility audit of the desktop window with
   fixes where cheap. Whatever needs physical hardware is recorded, not
   claimed.

## Interface rules

- Timing budgets live in tests with explicit margins and methodology notes;
  a budget failure is investigated as a regression, never tuned to fit.
- Null-device playback proves scheduling liveness, not acoustic quality or
  device timing.
- No test may depend on wall-clock precision tighter than CI runners can
  keep; droplet numbers are evidence, CI numbers are tripwires.

## Exit evidence

- Generator-backed perf tests green locally and in CI (or skipped loudly
  where no audio stack exists).
- Continuity, cycle and audit results in `DESKTOP_D6_VALIDATION.md` with
  hardware remainder explicitly listed.

## Non-goals

D4 recording, D5 agent workflow, D7 installers/signing, and real-device
dropout proof (needs hardware with real outputs).
