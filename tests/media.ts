import { frettedSong } from "./fretted.ts";
export function wav(
  seconds = 1,
  frequency = 220,
  sampleRate = 8000,
): ArrayBuffer {
  const frames = Math.round(seconds * sampleRate),
    buf = new ArrayBuffer(44 + frames * 2),
    v = new DataView(buf);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  v.setUint32(4, buf.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++)
    v.setInt16(
      44 + i * 2,
      Math.round(Math.sin((i * 2 * Math.PI * frequency) / sampleRate) * 8000),
      true,
    );
  return buf;
}
export function mediaSong() {
  const s = frettedSong("media-song");
  s.tables.parts.voice = {
    id: "voice",
    name: "Vocal ideas",
    instrument: "voice",
    volume: 0.8,
    muted: false,
  };
  return s;
}
