const record = (input: unknown): input is Record<string, unknown> =>
  input !== null && typeof input === "object" && !Array.isArray(input);

// Deterministic upgrades preserve legacy positions. Validation runs afterward.
export function migrateSong(input: unknown): unknown {
  if (!record(input)) return input;
  const s = structuredClone(input);
  if (s.schemaVersion !== 1 || !record(s.tables)) return s;
  s.schemaVersion = 2;
  s.tables.phrases ??= {};
  s.tables.lyrics ??= {};
  for (const [table, field] of [
    ["sections", "sourceId"],
    ["occurrences", "sectionId"],
  ] as const) {
    const entries = s.tables[table];
    if (record(entries))
      for (const entity of Object.values(entries))
        if (record(entity)) entity[field] = null;
  }
  return s;
}
