import { takeSchedule } from "../song/media.ts";
import { instrumentSource } from "./instruments.ts";
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
  takeId?: string;
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
    buffer?: AudioBuffer;
    mediaOffset?: number;
    takeId?: string;
  }[] = [];
  constructor(private readonly loadMedia?: (id: string) => Promise<Blob>) {}
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
    const takes = takeSchedule(song, from),
      buffers = new Map<string, AudioBuffer>();
    for (const take of takes)
      if (!buffers.has(take.assetId)) {
        if (!this.loadMedia)
          throw new Error("Audio media loader is unavailable");
        const blob = await this.loadMedia(take.assetId);
        const buffer = await this.context.decodeAudioData(
          await blob.arrayBuffer(),
        );
        if (generation !== this.generation) return;
        const metadata = song.tables.assets[take.assetId]!;
        if (Math.abs(buffer.duration - metadata.duration) > 0.005)
          throw new Error(
            "Recorded duration differs from saved asset metadata",
          );
        buffers.set(take.assetId, buffer);
      }
    if (generation !== this.generation) return;
    this.beatSeconds = secondsPerQuarter(song);
    this.offset = from;
    this.origin = this.context.currentTime + 0.06;
    this.scheduled = [];
    this.sequence = sounds(song).flatMap((n) => this.sound(n, from));
    for (const t of takes)
      this.sequence.push({
        at: t.at,
        duration: t.duration / this.beatSeconds,
        frequency: 0,
        gain: t.gain,
        kind: "take",
        buffer: buffers.get(t.assetId)!,
        mediaOffset: t.offset,
        takeId: t.takeId,
      });
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
      let source: AudioScheduledSourceNode, disconnect: () => void;
      if (n.buffer) {
        const node = ctx.createBufferSource(),
          gain = ctx.createGain();
        node.buffer = n.buffer;
        gain.gain.value = n.gain;
        node.connect(gain).connect(this.analyser!);
        node.start(at, n.mediaOffset ?? 0, duration);
        source = node;
        disconnect = () => {
          node.disconnect();
          gain.disconnect();
        };
      } else {
        const voice = instrumentSource(ctx, this.analyser!, n, at, duration);
        source = voice.source;
        disconnect = voice.disconnect;
      }
      this.sources.add(source);
      source.onended = () => {
        this.sources.delete(source);
        disconnect();
      };
      this.scheduled.push({
        at: when,
        duration,
        frequency: n.frequency,
        kind: n.kind,
        ...(n.takeId ? { takeId: n.takeId } : {}),
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
