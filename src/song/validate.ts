import { migrateSong } from "./migrate.ts";
import { sectionLength } from "./arrangement.ts";
import { TABLES, type Song, type Pitch } from "./model.ts";
import { add, cmp, time, type Time } from "./time.ts";
import { ok, err, type Result } from "../result.ts";
const assert = (yes: unknown, message: string): void => {
  if (!yes) throw new Error(message);
};
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const id = (v: unknown) =>
  typeof v === "string" &&
  /^[a-zA-Z0-9_-]{1,100}$/.test(v) &&
  !["__proto__", "constructor", "prototype"].includes(v);
const text = (v: unknown) => typeof v === "string" && v.length <= 10000;
const integer = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const scalar = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
function duration(v: unknown, positive = false): asserts v is Time {
  assert(
    Array.isArray(v) && v.length === 2,
    "Time must be [numerator, denominator]",
  );
  const a = v as number[];
  const t = time(a[0]!, a[1]!);
  assert(
    cmp(t, [0, 1]) >= (positive ? 1 : 0),
    "Musical time must be nonnegative (durations positive)",
  );
  assert(t[0] === a[0] && t[1] === a[1], "Time fractions must be normalized");
}
function pitch(v: unknown): asserts v is Pitch {
  assert(record(v), "Pitch must be an object");
  const p = v as Pitch;
  assert(
    integer(p.degree, 1, 7) &&
      integer(p.alteration, -4, 4) &&
      integer(p.octave, -5, 5),
    "Invalid relative pitch",
  );
}
export function validateSong(input: unknown): Result<Song> {
  try {
    assert(record(input), "Song must be an object");
    const s = migrateSong(input) as Song;
    assert(s.schemaVersion === 2, "Unsupported song schema version");
    assert(
      id(s.id) &&
        text(s.title) &&
        text(s.mode) &&
        s.degreeReference === "major",
      "Invalid song identity or tonality",
    );
    assert(
      record(s.tempo) && scalar(s.tempo.bpm, 10, 600),
      "Tempo must be between 10 and 600 BPM",
    );
    duration(s.tempo.beatUnit, true);
    assert(record(s.tables), "Song needs entity tables");
    let count = 0;
    for (const table of TABLES) {
      assert(record(s.tables[table]), `Missing table ${table}`);
      for (const [key, e] of Object.entries(s.tables[table])) {
        assert(
          record(e) && id(key) && e.id === key && text(e.name),
          `Invalid identity in ${table}: ${key}`,
        );
        if (++count > 20000) throw new Error("Song exceeds 20,000 entities");
      }
    }
    const t = s.tables;
    const ref = (table: keyof typeof t, v: unknown) =>
      assert(
        typeof v === "string" && Object.hasOwn(t[table], v),
        `Broken ${table} reference: ${String(v)}`,
      );
    for (const p of Object.values(t.parts))
      assert(
        ["guitar", "bass", "drums"].includes(p.instrument) &&
          scalar(p.volume, 0, 1) &&
          typeof p.muted === "boolean",
        "Invalid part",
      );
    for (const v of Object.values(t.voices)) ref("parts", v.partId);
    for (const p of Object.values(t.patterns)) {
      duration(p.length, true);
      assert(cmp(p.length, [10000, 1]) <= 0, "Pattern too long");
      if (p.sourceId !== null) {
        ref("patterns", p.sourceId);
        assert(p.sourceId !== p.id, "Pattern cannot vary itself");
      }
    }
    for (const c of Object.values(t.chords)) {
      assert(
        Array.isArray(c.notes) && c.notes.length > 0 && c.notes.length <= 64,
        "Chord must contain 1–64 notes",
      );
      const ids = new Set<string>();
      for (const n of c.notes) {
        assert(
          record(n) && id(n.id) && !ids.has(n.id),
          "Invalid or duplicate chord member",
        );
        ids.add(n.id);
        pitch(n.pitch);
      }
      assert(c.label === null || text(c.label), "Invalid chord label");
    }
    for (const e of Object.values(t.events)) {
      ref("patterns", e.patternId);
      duration(e.start);
      duration(e.duration, true);
      assert(
        cmp(e.start, t.patterns[e.patternId]!.length) < 0,
        "Event attack must be inside its pattern",
      );
      assert(
        ["note", "chord", "drum", "rest"].includes(e.kind) &&
          ["normal", "staccato", "sustain", "muted", "ghost"].includes(
            e.articulation,
          ),
        "Invalid event type",
      );
      pitch(e.pitch);
      assert(
        ["kick", "snare", "hat"].includes(e.drum) && scalar(e.accent, 0, 1),
        "Invalid event expression",
      );
      if (e.kind === "chord") ref("chords", e.chordId);
      else assert(e.chordId === null, "Only chord events reference chords");
      assert(
        Array.isArray(e.performance) && e.performance.length <= 64,
        "Invalid chord performance",
      );
      assert(
        e.kind === "chord" || e.performance.length === 0,
        "Only chords have member performances",
      );
      const seen = new Set<string>();
      for (const p of e.performance) {
        assert(
          record(p) &&
            !seen.has(p.memberId) &&
            t.chords[e.chordId!]!.notes.some((n) => n.id === p.memberId),
          "Broken/duplicate chord member reference",
        );
        seen.add(p.memberId);
        duration(p.offset);
        duration(p.duration, true);
      }
    }
    for (const b of Object.values(t.bars)) {
      ref("sections", b.sectionId);
      assert(
        integer(b.numerator, 1, 64) &&
          [1, 2, 4, 8, 16, 32, 64].includes(b.denominator),
        "Invalid time signature",
      );
      assert(
        Array.isArray(b.groups) &&
          b.groups.length > 0 &&
          b.groups.every((g) => integer(g, 1, 64)) &&
          b.groups.reduce((a, b) => a + b, 0) === b.numerator,
        "Beat groups must sum to numerator",
      );
      if (b.actual !== null) {
        duration(b.actual, true);
        assert(
          cmp(b.actual, time(b.numerator * 4, b.denominator)) <= 0,
          "Incomplete bar cannot exceed full bar",
        );
      }
    }
    const assigned = new Set<string>();
    for (const sec of Object.values(t.sections)) {
      if (sec.sourceId !== null) {
        ref("sections", sec.sourceId);
        assert(sec.sourceId !== sec.id, "Section cannot vary itself");
      }
      assert(Array.isArray(sec.barIds), "Section needs bar order");
      for (const b of sec.barIds) {
        ref("bars", b);
        assert(
          t.bars[b]!.sectionId === sec.id && !assigned.has(b),
          "Invalid/duplicate section bar",
        );
        assigned.add(b);
      }
    }
    assert(
      assigned.size === Object.keys(t.bars).length,
      "Every bar must appear in its section",
    );
    for (const a of Object.values(t.arrangement)) ref("sections", a.sectionId);
    assert(
      Array.isArray(s.arrangementOrder) &&
        new Set(s.arrangementOrder).size === s.arrangementOrder.length,
      "Invalid arrangement order",
    );
    for (const a of s.arrangementOrder) ref("arrangement", a);
    assert(
      s.arrangementOrder.length === Object.keys(t.arrangement).length,
      "Every section occurrence needs an order",
    );
    for (const o of Object.values(t.occurrences)) {
      if (o.sectionId !== null) ref("sections", o.sectionId);
      ref("patterns", o.patternId);
      ref("voices", o.voiceId);
      duration(o.start);
      duration(o.span, true);
      duration(o.phase);
      if (o.sectionId !== null)
        assert(
          cmp(add(o.start, o.span), sectionLength(s, o.sectionId)) <= 0,
          `Placement ${o.name} exceeds its section; adjust its start/span explicitly`,
        );
      assert(
        cmp(o.phase, t.patterns[o.patternId]!.length) < 0,
        "Phase must be inside pattern",
      );
      assert(
        ["continue", "restart", "stop"].includes(o.boundary) &&
          ["ring", "cut"].includes(o.tails),
        "Invalid boundary choice",
      );
    }
    for (const table of ["phrases", "lyrics"] as const)
      for (const e of Object.values(t[table])) {
        ref("sections", e.sectionId);
        duration(e.start);
        duration(e.duration, true);
        assert(
          cmp(add(e.start, e.duration), sectionLength(s, e.sectionId)) <= 0,
          `${table}/${e.id} exceeds its section`,
        );
      }
    for (const l of Object.values(t.lyrics)) {
      assert(text(l.text), "Invalid lyric text");
      if (l.partId !== null) ref("parts", l.partId);
      if (l.phraseId !== null) {
        ref("phrases", l.phraseId);
        const p = t.phrases[l.phraseId]!;
        assert(
          l.sectionId === p.sectionId &&
            cmp(l.start, p.start) >= 0 &&
            cmp(add(l.start, l.duration), add(p.start, p.duration)) <= 0,
          "Linked phrase must contain its lyric span",
        );
      }
    }
    for (const table of ["sections", "patterns"] as const)
      for (const e of Object.values(t[table])) {
        const seen = new Set([e.id]);
        let parent = e.sourceId;
        while (parent !== null) {
          assert(!seen.has(parent), `Cyclic ${table} lineage`);
          seen.add(parent);
          parent = t[table][parent]!.sourceId;
        }
      }
    for (const m of Object.values(t.markers)) duration(m.at);
    return ok(structuredClone(s));
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
