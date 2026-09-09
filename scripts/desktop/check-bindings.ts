import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "songwriter-bindings-"));
try {
  const result = Bun.spawnSync(["cargo", "run", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "-p", "song-session", "--example", "bindings", "--", directory], { stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error("Rust binding generation failed");
  const generated = readdirSync(directory).sort(), checked = readdirSync("src/generated/desktop").sort();
  if (JSON.stringify(generated) !== JSON.stringify(checked)) throw new Error("Desktop binding file list is stale");
  for (const name of generated) {
    if (!readFileSync(join(directory, name)).equals(readFileSync(join("src/generated/desktop", name)))) throw new Error(`Stale desktop binding: ${name}`);
  }
  console.log("Rust/TypeScript desktop bindings are current.");
} finally { rmSync(directory, { recursive: true, force: true }); }
