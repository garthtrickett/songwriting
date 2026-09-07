import type { Song } from "../song/model.ts";
import { semitone } from "../song/model.ts";
import {
  sounds,
  clicks,
  secondsPerQuarter,
  songEnd,
  type Sound,
} from "../song/timeline.ts";
import { value } from "../song/time.ts";
export interface Scheduled {
  at: number;
  duration: number;
  frequency: number;
  kind: string;
}
export class AudioEngine {
  private context: AudioContext | null = null;
  private sources = new Set<AudioScheduledSourceNode>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private origin = 0;
  private offset = 0;
  private beatSeconds = 1;
  private sequence: {
    at: number;
    duration: number;
    frequency: number;
    gain: number;
    kind: string;
  }[] = [];
  private next = 0;
  private end = 0;
  onChange: () => void = () => {};
  private generation = 0;
  private analyser: AnalyserNode | null = null;
  playing = false;
  scheduled: Scheduled[] = [];
  tonic = 48;
  metronome = true;
  get position() {
    return this.playing && this.context
      ? Math.max(
          this.offset,
          this.offset +
            (this.context.currentTime - this.origin) / this.beatSeconds,
        )
      : this.offset;
  }
  async play(song: Song, from = 0) {
    this.stop();
    const generation = this.generation;
    this.context ??= new AudioContext();
    this.analyser ??= this.context.createAnalyser();
    this.analyser.connect(this.context.destination);
    if (
      this.context.state !== "running" &&
      navigator.userActivation &&
      !navigator.userActivation.hasBeenActive
    )
      throw new Error(
        "Click Play in the editor to enable browser audio, then retry.",
      );
    await this.context.resume();
    if (generation !== this.generation) return;
    if (this.context.state !== "running")
      throw new Error("Click Play to enable browser audio");
    this.beatSeconds = secondsPerQuarter(song);
    this.offset = from;
    this.origin = this.context.currentTime + 0.06;
    this.scheduled = [];
    this.sequence = sounds(song).flatMap((n) => this.sound(n, from));
    if (this.metronome)
      for (const c of clicks(song)) {
        const at = value(c.at);
        if (at >= from)
          this.sequence.push({
            at,
            duration: 0.06 / this.beatSeconds,
            frequency: c.strong ? 1500 : 950,
            gain: c.strong ? 0.18 : 0.1,
            kind: "click",
          });
      }
    this.sequence.sort((a, b) => a.at - b.at);
    this.next = 0;
    this.end = Math.max(
      value(songEnd(song)),
      ...this.sequence.map((n) => n.at + n.duration),
    );
    this.playing = true;
    this.pump();
    this.timer = setInterval(() => this.pump(), 25);
  }
  private sound(n: Sound, from: number) {
    const start = value(n.start),
      end = start + value(n.duration);
    if (end <= from) return [];
    const at = Math.max(start, from);
    return [
      {
        at,
        duration: end - at,
        frequency: n.pitch
          ? 440 * 2 ** ((this.tonic + semitone(n.pitch) - 69) / 12)
          : n.drum === "kick"
            ? 70
            : n.drum === "snare"
              ? 180
              : 7000,
        gain: n.gain * 0.2,
        kind: n.pitch ? n.instrument : n.drum,
      },
    ];
  }
  private pump() {
    const ctx = this.context;
    if (!ctx || !this.playing) return;
    while (this.next < this.sequence.length) {
      const n = this.sequence[this.next]!;
      const when = this.origin + (n.at - this.offset) * this.beatSeconds;
      if (when > ctx.currentTime + 0.15) break;
      this.next++;
      const at = Math.max(ctx.currentTime, when),
        duration = n.duration * this.beatSeconds;
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.type =
        n.kind === "bass" ? "sine" : n.kind === "hat" ? "square" : "triangle";
      osc.frequency.setValueAtTime(n.frequency, at);
      if (n.kind === "kick")
        osc.frequency.exponentialRampToValueAtTime(
          35,
          at + Math.min(duration, 0.12),
        );
      const end = at + Math.max(duration, 0.005);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(
        n.gain,
        at + Math.min(0.005, duration / 3),
      );
      gain.gain.setValueAtTime(n.gain, Math.max(at + 0.002, end - 0.015));
      gain.gain.linearRampToValueAtTime(0, end);
      osc.connect(gain).connect(this.analyser!);
      osc.start(at);
      osc.stop(end + 0.01);
      this.sources.add(osc);
      osc.onended = () => {
        this.sources.delete(osc);
        osc.disconnect();
        gain.disconnect();
      };
      this.scheduled.push({
        at: when,
        duration,
        frequency: n.frequency,
        kind: n.kind,
      });
    }
    if (this.position > this.end + 0.1) this.stop();
  }
  stop() {
    this.generation++;
    this.offset = Math.max(0, this.position);
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const node of this.sources) {
      try {
        node.stop();
      } catch {
        /* already ended */
      }
    }
    this.sources.clear();
    this.onChange();
  }
  seek(position: number) {
    this.stop();
    this.offset = Math.max(0, position);
  }
  dispose() {
    this.stop();
    void this.context?.close();
    this.context = null;
  }
  get outputLevel() {
    if (!this.analyser) return 0;
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    return Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
  }
  get activeSources() {
    return this.sources.size;
  }
}
