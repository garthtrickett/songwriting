import { test, expect } from "bun:test";
import { snapshot, type Snapshot } from "./wire.ts";
import { DesktopClient, type Transport } from "./client.ts";
import type { EditRequest } from "../../generated/desktop/EditRequest.ts";

const library = (): Snapshot["library"] => ({ appearances: [], markers: [], annotations: [], harmony: [],
  parts: [], voices: [], chords: [], polyrhythms: [], fretted: [], takes: [], lyrics: [], phrases: [], prompts: [],
  writing: { instructions: "", preferences: "", mode: "major", degreeReference: "major", bpm: 120, beatUnit: [1, 1] } });
const state = (revision = 0): Snapshot => ({ protocol: 1, epoch: "session-one", profile: "Local profile", revision,
  title: "Sketch", patterns: [], notes: [], bars: [], placements: [], library: library(), undoable: [], redoable: [], warning: null });
function setup() {
  let changed: (value: unknown) => void = () => {};
  let stopped = false;
  const transport: Transport = { open: async () => state(), dispatch: async () => state(1),
    listen: async (fn) => { changed = fn; return () => { stopped = true; }; } };
  return { transport, changed: (value: unknown) => changed(value), stopped: () => stopped,
    client: new DesktopClient(transport, () => "operation-one") };
}
test("subscription before snapshot preserves a concurrent edit and ignores older snapshots", async () => {
  const f = setup();
  f.transport.open = async () => { f.changed(state(2)); return state(1); };
  await f.client.connect();
  expect(f.client.state?.revision).toBe(2);
  f.changed(state(0));
  expect(f.client.state?.revision).toBe(2);
  f.changed({ ...state(9), epoch: "another-session" });
  expect(f.client.state?.revision).toBe(2);
  f.client.dispose(); expect(f.stopped()).toBe(true);
});
test("a lost reply retains the identical request through reconnect and receipt-first retry", async () => {
  const f = setup(); await f.client.connect();
  const requests: EditRequest[] = [];
  f.transport.open = async () => state(1);
  f.transport.dispatch = async (r) => { requests.push(structuredClone(r)); throw new Error("lost reply after commit"); };
  expect(await f.client.edit({ kind: "rename", title: "Saved" }, f.client.state!, "Rename")).toBe(false);
  expect(f.client.pending?.expectedRevision).toBe(0);
  expect(f.client.state?.revision).toBe(1);
  f.transport.dispatch = async (r) => { requests.push(structuredClone(r)); return state(1); };
  expect(await f.client.retry()).toBe(true);
  expect(requests[1]).toEqual(requests[0]);
  expect(f.client.pending).toBeNull(); f.client.dispose();
});
test("stale drafts use their captured revision and definitive rejection refreshes without replay", async () => {
  const f = setup(); await f.client.connect(); const base = f.client.state!;
  f.changed(state(2));
  let request: EditRequest | undefined;
  f.transport.open = async () => state(2);
  f.transport.dispatch = async (r) => { request = r; throw { code: "conflict", message: "Refresh before editing" }; };
  expect(await f.client.edit({ kind: "rename", title: "Draft" }, base, "Rename")).toBe(false);
  expect(request?.expectedRevision).toBe(0);
  expect(f.client.pending).toBeNull(); expect(f.client.state?.revision).toBe(2);
  expect(f.client.error).toContain("Refresh"); f.client.dispose();
});
test("malformed state cannot replace the last valid view or become a successful save", async () => {
  const f = setup(); await f.client.connect();
  f.changed({ protocol: 1 });
  expect(f.client.status).toBe("offline"); expect(f.client.state?.title).toBe("Sketch");
  await f.client.connect();
  f.transport.dispatch = async () => ({ ...state(1), notes: [{ row: Number.NaN }] });
  expect(await f.client.edit({ kind: "rename", title: "Draft" }, f.client.state!, "Rename")).toBe(false);
  expect(f.client.pending).not.toBeNull(); f.client.dispose();
});
test("disposal during listener registration releases the late listener", async () => {
  const f = setup(); let finish: ((stop: () => void) => void) | undefined;
  let released = false;
  f.transport.listen = () => new Promise((resolve) => { finish = resolve; });
  const opening = f.client.connect(); f.client.dispose();
  finish!(() => { released = true; }); await opening;
  expect(released).toBe(true); expect(f.client.state).toBeNull();
});

// The library reaches the view as rendered rows, so its shape is validated on
// arrival like every other part of the snapshot. These cases fail if the
// validation is removed: a no-op validator would accept all three.
test("a snapshot without a library is rejected rather than rendered half-formed", () => {
  const { library: _dropped, ...without } = state();
  expect(() => snapshot(without)).toThrow();
});

test("a malformed library row is rejected", () => {
  const bad = state();
  bad.library.voices = [{ id: "v1", name: "Lead", partId: "p1", part: 7 } as unknown as Snapshot["library"]["voices"][number]];
  expect(() => snapshot(bad)).toThrow();
  const badTime = state();
  badTime.library.markers = [{ id: "m1", name: "Drop", at: [1, 0] } as unknown as Snapshot["library"]["markers"][number]];
  expect(() => snapshot(badTime)).toThrow("Invalid desktop state");
});

test("a well-formed library survives validation with its rows intact", () => {
  const good = state();
  good.library.markers = [{ id: "m1", name: "Drop", at: [4, 1] }];
  good.library.writing.instructions = "keep it crooked";
  const out = snapshot(good);
  expect(out.library.markers[0]!.name).toBe("Drop");
  expect(out.library.writing.instructions).toBe("keep it crooked");
});
