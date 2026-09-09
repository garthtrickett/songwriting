# Songwriting project

This is a standalone TypeScript app, independent of the Gust compiler lanes.
Read PLAN.md, PHASES.md, and CONTEXT.md before implementation changes.

- Keep shared musical edits in the headless command path. UI and agent tools
  must have outcome parity; update docs/CAPABILITIES.md when capabilities change.
- Preserve exact musical time, relative pitch, chord membership, voice identity,
  revision checks, and durable operation receipts.
- Run bun run verify and relevant browser tests. Do not bypass a failing check.
- For Rust desktop changes, also run bun run verify:desktop. Keep the Rust core
  independent of Tauri/devices and compare musical behavior against the checked
  TypeScript fixtures. Do not claim the headless fixture runner is a desktop app.
- Never commit .agent/, provider credentials, or a user's browser database.
- Only implement the active phase. Later phases remain high-level until selected.
- Record validation and remaining limitations honestly; browser tool tests are
  not substitutes for a real-model evaluation.
