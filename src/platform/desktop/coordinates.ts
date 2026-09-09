import type { Time } from "../../generated/desktop/Time.ts";
export const value = (t: Time) => t[0] / t[1];
export const format = (t: Time) => t[1] === 1 ? String(t[0]) : `${t[0]}/${t[1]}`;

// Only pointer/text-to-wire conversion lives here. Rust decides whether this
// proposed musical position is valid and how other notes respond to it.
export function fraction(n: number, d: number): Time {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || d <= 0) throw new Error("Use a whole number or fraction, such as 2/3.");
  let a = Math.abs(n), b = d;
  while (b) [a, b] = [b, a % b];
  return [n / a, d / a];
}
export function parse(text: string): Time {
  if (!/^-?\d+(\/\d+)?$/.test(text.trim())) throw new Error("Use a whole number or fraction, such as 2/3.");
  const [n, d = "1"] = text.trim().split("/");
  return fraction(Number(n), Number(d));
}
