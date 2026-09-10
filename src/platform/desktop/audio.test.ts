import { expect, test } from "bun:test";
import { AudioClient, audioView, outputDevices, type AudioTransport } from "./audio.ts";
const state = { generation: 1, status: "playing", device: "test", sampleRate: 48000, channels: 2, frames: 100, totalFrames: 1000, callbacks: 1, xruns: 0, level: 0.25, warning: null, revision: 0, error: null };
test("audio boundary rejects malformed data and counters", () => {
  expect(() => audioView({})).toThrow();
  expect(() => audioView({...state, frames: 2000})).toThrow();
  expect(() => audioView({...state, level: 2})).toThrow();
  expect(() => outputDevices([{}])).toThrow();
  expect(audioView(state).frames).toBe(100);
});
test("stop remains available during pending start and ignores late cancellation error", async () => {
  let reject!: (e: unknown) => void;
  let stopped = false;
  const transport: AudioTransport = {
    status: async () => stopped ? {...state,generation:2,status:"stopped"} : state,
    devices: async () => [], play: () => new Promise((_,r) => { reject=r; }), stop: async () => { stopped=true; },
  };
  const client=new AudioClient(transport);
  const play=client.play(null); expect(client.busy).toBe(true);
  await client.stop(); expect(stopped).toBe(true); expect(client.busy).toBe(false);
  reject(new Error("Superseded")); await play;
  expect(client.error).toBe(""); expect(client.state.status).toBe("stopped"); client.dispose();
});
test("device failures stay visible and stale polls cannot restore old playback", async () => {
  let reply!: (s: unknown) => void;
  const transport: AudioTransport = { status: () => new Promise(r => {reply=r;}), devices: async () => [], play: async () => {throw new Error("Output unavailable");}, stop: async () => {} };
  const client=new AudioClient(transport);
  const old=client.refresh();
  transport.status=async () => ({...state,generation:2,status:"stopped"});
  await client.stop(); reply(state); await old;
  expect(client.state.status).toBe("stopped");
  await client.play("missing"); expect(client.error).toContain("Output unavailable"); client.dispose();
});
test("play forwards device, key, metronome and seek position", async () => {
  let request: unknown = null;
  const transport: AudioTransport = {
    status: async () => state, devices: async () => [],
    play: async (r) => { request = r; }, stop: async () => {},
  };
  const client = new AudioClient(transport);
  await client.play("out", { tonic: 48, metronome: false, from: [1, 2] });
  expect(request).toEqual({ deviceId: "out", tonic: 48, metronome: false, from: [1, 2] });
  await client.play(null);
  expect(request).toEqual({ deviceId: null, tonic: null, metronome: true, from: null });
  client.dispose();
});
