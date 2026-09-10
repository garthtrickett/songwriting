// The desktop runtime must not depend on the TypeScript domain model or the
// browser app: Lit renders generated contracts through thin transports, and
// Rust owns acceptance. Fails on any import under src/song or src/app.
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, normalize } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const BANNED = ["src/song/", "src/app/"];
const seen = new Set<string>(["src/platform/desktop/main.ts"]);
const queue = [...seen];
const violations: string[] = [];
while (queue.length) {
  const file = queue.pop()!;
  const path = resolve(ROOT, file);
  if (!existsSync(path) || (!path.endsWith(".ts") && !path.endsWith(".tsx"))) continue;
  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
    const specifier = match[1]!;
    if (!specifier.startsWith(".")) continue;
    const target = normalize(
      resolve(dirname(path), specifier)
        .replace(ROOT + "/", "")
        .replace(/\.tsx?$/, ".ts"),
    );
    const hit = BANNED.find((prefix) => target.startsWith(prefix));
    if (hit) violations.push(`${file} imports ${target}`);
    else if (!seen.has(target)) {
      seen.add(target);
      queue.push(target);
    }
  }
}
if (violations.length) {
  for (const violation of violations) console.error(violation);
  throw new Error(`Desktop runtime depends on the TypeScript domain: ${violations.length} import(s)`);
}
console.log(`Desktop imports checked: ${seen.size} modules, no src/song or src/app dependencies.`);
