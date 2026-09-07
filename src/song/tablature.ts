import { type Song, type Fingering } from "./model.ts";
import { sounds, type Sound } from "./timeline.ts";
import { add, cmp, time, ZERO, type Time } from "./time.ts";
import { connected, fingeringIssues } from "./fretted.ts";
interface TabRow extends Sound {
  fingering: Fingering | null;
  issues: string[];
}
export function tablature(
  s: Song,
  arrangementId: string,
  from: Time,
  until: Time,
) {
  const a = s.tables.fretted[arrangementId];
  if (!a) throw new Error("Unknown fretted arrangement");
  for (const at of [from, until])
    if (
      !Array.isArray(at) ||
      at.length !== 2 ||
      time(at[0], at[1]).join() !== at.join() ||
      cmp(at, ZERO) < 0
    )
      throw new Error("Use exact nonnegative tab range");
  if (cmp(until, from) <= 0) throw new Error("Tab end must follow start");
  const fs = Object.values(s.tables.fingerings).filter(
    (f) => f.arrangementId === a.id,
  );
  const key = (o: string, e: string, m: string | null) =>
    JSON.stringify([o, e, m]);
  const byTarget = new Map(
    fs.map((f) => [key(f.occurrenceId, f.eventId, f.memberId), f]),
  );
  const issues = new Map(fs.map((f) => [f.id, fingeringIssues(s, f)]));
  // A muted audition part still has a written arrangement to practise.
  const music = {
    ...s,
    tables: {
      ...s.tables,
      parts: {
        ...s.tables.parts,
        [a.partId]: { ...s.tables.parts[a.partId]!, muted: false },
      },
    },
  };
  const all: TabRow[] = sounds(music)
    .filter((n) => n.partId === a.partId && n.pitch)
    .map((n) => {
      const f =
        byTarget.get(key(n.occurrenceId, n.eventId, n.memberId)) ?? null;
      return {
        ...n,
        fingering: f,
        issues: f ? [...issues.get(f.id)!] : ["Unassigned note"],
      };
    });
  if (all.length > 5000)
    throw new Error(
      "Tab diagnostics support at most 5,000 realised notes per arrangement",
    );
  let work = 0;
  const ends = new Map(all.map((n) => [n.id, add(n.start, n.duration)]));
  // Connected attacks consume the previous string vibration only in this physical view.
  for (let i = 0; i < all.length; i++) {
    const n = all[i]!,
      f = n.fingering;
    if (!f || !connected(f) || n.issues.length) continue;
    let source: TabRow | undefined;
    for (let j = i - 1; j >= 0; j--) {
      if (++work > 2000000)
        throw new Error("Tab diagnostic work limit exceeded");
      const prev = all[j]!;
      if (prev.fingering?.string !== f.string || cmp(prev.start, n.start) >= 0)
        continue;
      if (
        prev.fingering.id === f.fromId &&
        !prev.issues.length &&
        cmp(ends.get(prev.id)!, n.start) >= 0
      )
        source = prev;
      break;
    }
    if (source) ends.set(source.id, n.start);
    else
      n.issues.push(
        "Technique source is not the preceding sounding note on this string",
      );
  }
  let active: TabRow[] = [];
  for (const n of all) {
    active = active.filter((p) => cmp(ends.get(p.id)!, n.start) > 0);
    if (n.fingering) {
      for (const p of active) {
        if (++work > 2000000)
          throw new Error("Tab diagnostic work limit exceeded");
        if (p.fingering?.string === n.fingering.string) {
          n.issues.push(`String collision with ${p.eventId} (${p.voiceId})`);
          p.issues.push(`String collision with ${n.eventId} (${n.voiceId})`);
        }
      }
      active.push(n);
      const held = active.filter(
        (p) =>
          p.fingering &&
          p.fingering.fret > 0 &&
          p.fingering.technique !== "tap",
      );
      const frets = held.map((p) => p.fingering!.fret);
      if (frets.length && Math.max(...frets) - Math.min(...frets) > a.handSpan)
        for (const p of held) p.issues.push("Preferred hand span exceeded");
    }
  }
  const selected = all.filter(
    (n) => cmp(n.start, until) < 0 && cmp(add(n.start, n.duration), from) > 0,
  );
  const rows = selected
    .slice(0, 512)
    .map((n) => ({ ...n, issues: [...new Set(n.issues)] }));
  return {
    arrangement: a,
    from,
    until,
    rows,
    total: selected.length,
    truncated: selected.length > rows.length,
    issueCount: selected.filter((n) => n.issues.length).length,
    stale: fs.flatMap((f) =>
      issues.get(f.id)!.length ? [{ id: f.id, issues: issues.get(f.id)! }] : [],
    ),
    unplaced: fs
      .filter((f) => !all.some((n) => n.fingering?.id === f.id))
      .map((f) => f.id),
  };
}
