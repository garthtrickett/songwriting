import { expect, test } from "bun:test";
import { MediaClient, mediaView, type MediaTransport } from "./media.ts";
const asset = { id: "a".repeat(64), bytes: 44100, audio: { sampleRate: 48000, channels: 1, frames: 48000, peak: 0.5, rms: 0.25 }, error: null };
const capture = { id: "take-1", status: "interrupted", sampleRate: 48000, channels: 1, frames: 24000, assetId: null, error: "Host stopped" };
const state = { available: true, decoder: "ffmpeg", assets: [asset], captures: [capture], error: null };
test("media boundary rejects malformed data and shapes", () => {
  expect(() => mediaView({})).toThrow();
  expect(() => mediaView({ ...state, assets: [{ ...asset, id: "xyz" }] })).toThrow();
  expect(() => mediaView({ ...state, captures: [{ ...capture, status: "recording-forever" }] })).toThrow();
  expect(() => mediaView({ ...state, captures: [{ ...capture, channels: 6 }] })).toThrow();
  expect(mediaView(state).assets.length).toBe(1);
});
test("media refresh keeps stale polls from overwriting newer status", async () => {
  let reply!: (s: unknown) => void;
  const transport: MediaTransport = { status: () => new Promise(r => { reply = r; }) };
  const client = new MediaClient(transport);
  expect(client.loaded).toBe(false);
  const old = client.refresh();
  transport.status = async () => ({ ...state, assets: [] });
  await client.refresh();
  expect(client.state.assets.length).toBe(0);
  reply(state);
  await old;
  expect(client.state.assets.length).toBe(0);
  expect(client.loaded).toBe(true);
  client.dispose();
});
test("media transport failures stay visible without crashing refresh", async () => {
  const transport: MediaTransport = { status: async () => { throw new Error("Profile locked"); } };
  const client = new MediaClient(transport);
  await client.refresh();
  expect(client.error).toContain("Profile locked");
  expect(client.loaded).toBe(true);
  client.dispose();
});
