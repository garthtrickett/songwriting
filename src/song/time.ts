// Exact quarter-note units. BigInt intermediates prevent silent arithmetic overflow.
export type Time = readonly [number, number];
const gcd = (a: bigint, b: bigint): bigint =>
  b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b);
const bound = BigInt(Number.MAX_SAFE_INTEGER);
const ratio = (n: bigint, d: bigint): Time => {
  if (d === 0n) throw new Error("Time denominator must be positive");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  n /= g;
  d /= g;
  if (n > bound || n < -bound || d > bound)
    throw new Error("Musical time exceeds exact arithmetic bounds");
  return [Number(n), Number(d)];
};
export const time = (n: number, d = 1): Time => {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || d <= 0)
    throw new Error(
      "Time requires safe integer numerator and positive denominator",
    );
  return ratio(BigInt(n), BigInt(d));
};
export const add = (a: Time, b: Time): Time =>
  ratio(
    BigInt(a[0]) * BigInt(b[1]) + BigInt(b[0]) * BigInt(a[1]),
    BigInt(a[1]) * BigInt(b[1]),
  );
export const sub = (a: Time, b: Time): Time => add(a, [-b[0], b[1]]);
export const mul = (a: Time, b: Time): Time =>
  ratio(BigInt(a[0]) * BigInt(b[0]), BigInt(a[1]) * BigInt(b[1]));
export const cmp = (a: Time, b: Time): number => {
  const x = BigInt(a[0]) * BigInt(b[1]) - BigInt(b[0]) * BigInt(a[1]);
  return x < 0n ? -1 : x > 0n ? 1 : 0;
};
export const value = (a: Time) => a[0] / a[1];
export const format = (a: Time) =>
  a[1] === 1 ? String(a[0]) : `${a[0]}/${a[1]}`;
export const parse = (s: string): Time => {
  const parts = s.trim().split("/");
  if (parts.length > 2 || !parts[0])
    throw new Error("Use a number or fraction");
  return time(Number(parts[0]), Number(parts[1] ?? 1));
};
export const ZERO: Time = [0, 1];

export function modulo(a: Time, length: Time): Time {
  if (cmp(length, ZERO) <= 0) throw new Error("Cycle length must be positive");
  const numerator = BigInt(a[0]) * BigInt(length[1]);
  const denominator = BigInt(a[1]) * BigInt(length[0]);
  let q = numerator / denominator;
  if (numerator < 0n && numerator % denominator !== 0n) q--;
  return ratio(
    BigInt(a[0]) * BigInt(length[1]) - q * BigInt(length[0]) * BigInt(a[1]),
    BigInt(a[1]) * BigInt(length[1]),
  );
}
