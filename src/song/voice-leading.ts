import { semitone, type Song } from "./model.ts";
import { shiftPitch } from "./harmony-pitch.ts";
export function voiceLeading(
  s: Song,
  sourceId: string,
  targetId: string,
  radius: number,
) {
  const source = s.tables.chords[sourceId],
    target = s.tables.chords[targetId];
  if (!source || !target) throw new Error("Choose two chords");
  if (
    source.notes.length > 8 ||
    target.notes.length > 8 ||
    !Number.isInteger(radius) ||
    radius < 0 ||
    radius > 2
  )
    throw new Error(
      "Voice leading supports 1–8 notes per chord and octave radius 0–2",
    );
  const left = [...source.notes].sort(
      (a, b) => semitone(a.pitch) - semitone(b.pitch),
    ),
    right = target.notes;
  const n = Math.max(left.length, right.length);
  const matrix = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      const a = left[i],
        b = right[j];
      if (!a || !b) return { cost: 0, pitch: b?.pitch ?? null };
      const offsets = [
        0,
        ...Array.from({ length: radius }, (_, k) => [-k - 1, k + 1]).flat(),
      ];
      const options = offsets.flatMap((k) => {
        try {
          const pitch = shiftPitch(b.pitch, k * 7, k * 12);
          return [
            { pitch, cost: Math.abs(semitone(pitch) - semitone(a.pitch)) },
          ];
        } catch {
          return [];
        }
      });
      return options.sort((a, b) => a.cost - b.cost)[0]!;
    }),
  );
  const memo = new Map<number, { cost: number; columns: number[] }>();
  const solve = (
    row: number,
    mask: number,
  ): { cost: number; columns: number[] } => {
    if (row === n) return { cost: 0, columns: [] };
    const known = memo.get(mask);
    if (known) return known;
    let best = { cost: Infinity, columns: [] as number[] };
    for (let j = 0; j < n; j++)
      if (!(mask & (1 << j))) {
        const rest = solve(row + 1, mask | (1 << j)),
          cost = matrix[row]![j]!.cost + rest.cost;
        if (cost < best.cost) best = { cost, columns: [j, ...rest.columns] };
      }
    memo.set(mask, best);
    return best;
  };
  const best = solve(0, 0),
    notes = structuredClone(right);
  const moves = best.columns.map((j, i) => {
    const before = left[i] ?? null,
      after = right[j] ?? null,
      pitch = matrix[i]![j]!.pitch;
    if (after && pitch) notes[j]!.pitch = pitch;
    return {
      sourceMemberId: before?.id ?? null,
      targetMemberId: after?.id ?? null,
      from: before?.pitch ?? null,
      to: pitch,
      semitones:
        before && pitch ? semitone(pitch) - semitone(before.pitch) : null,
      status: !before ? "added" : !after ? "removed" : "matched",
    };
  });
  return {
    sourceId,
    targetId,
    octaveRadius: radius,
    totalMotion: best.cost,
    moves,
    notes,
    affectedEvents: Object.values(s.tables.events)
      .filter((e) => e.chordId === targetId)
      .map((e) => e.id),
  };
}
