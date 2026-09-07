const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

// Additive defaults also upgrade mixed-version history values without erasing
// lineage established by later edits. Operation fingerprints stay untouched.
export function migrateEntity(table: string, value: unknown): unknown {
  if (!record(value)) return value;
  const e = structuredClone(value);
  if (table === "sections" && !("sourceId" in e)) e.sourceId = null;
  if (table === "occurrences" && !("sectionId" in e)) e.sectionId = null;
  if (table === "patterns" && !("groups" in e)) e.groups = [];
  if (table === "events" && !("originId" in e)) e.originId = e.id;
  return e;
}
export function migrateSong(input: unknown): unknown {
  if (!record(input)) return input;
  const s = structuredClone(input);
  if ((s.schemaVersion !== 1 && s.schemaVersion !== 2) || !record(s.tables))
    return s;
  s.schemaVersion = 3;
  s.tables.phrases ??= {};
  s.tables.lyrics ??= {};
  s.tables.polyrhythms ??= {};
  for (const table of ["sections", "occurrences", "patterns", "events"]) {
    const entries = s.tables[table];
    if (record(entries))
      for (const [id, e] of Object.entries(entries))
        entries[id] = migrateEntity(table, e);
  }
  return s;
}
