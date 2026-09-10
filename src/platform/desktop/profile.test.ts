import { expect, test } from "bun:test";
import { ProfileClient } from "./profile.ts";
import type { ProfileView } from "../../generated/desktop/ProfileView.ts";
import { profileList, type ProfileTransport } from "./native.ts";
const one = { id: "default", title: "Sketch", revision: 0 };
const two = { id: "second", title: null, revision: null };
test("profile boundary rejects malformed data and shapes", () => {
  expect(() => profileList({})).toThrow();
  expect(() => profileList([{ ...one, id: "" }])).toThrow();
  expect(() => profileList([{ ...one, revision: -1 }])).toThrow();
  expect(profileList([one, two]).length).toBe(2);
});
test("profile refresh keeps stale polls from overwriting newer lists", async () => {
  let reply!: (s: unknown) => void;
  const transport: ProfileTransport = {
    list: () => new Promise(r => { reply = r; }),
    create: async () => {},
    switchTo: async () => {},
  };
  const client = new ProfileClient(transport);
  expect(client.loaded).toBe(false);
  const old = client.refresh();
  transport.list = async () => [one, two];
  await client.refresh();
  expect(client.profiles.length).toBe(2);
  reply([one]);
  await old;
  expect(client.profiles.length).toBe(2);
  expect(client.loaded).toBe(true);
  client.dispose();
});
test("profile create and switch failures stay visible", async () => {
  const transport: ProfileTransport = {
    list: async () => [one],
    create: async () => { throw new Error("Profile already exists"); },
    switchTo: async () => { throw new Error("Profile is locked"); },
  };
  const client = new ProfileClient(transport);
  await client.create("default");
  expect(client.error).toContain("already exists");
  await client.switchTo("second", async () => {});
  expect(client.error).toContain("locked");
  client.dispose();
});
test("profile switch refreshes the list afterwards", async () => {
  let ids: ProfileView[] = [one];
  const transport: ProfileTransport = {
    list: async () => ids,
    create: async () => { ids = [one, two]; },
    switchTo: async () => {},
  };
  const client = new ProfileClient(transport);
  let switched = false;
  await client.create("second");
  expect(client.profiles.length).toBe(2);
  await client.switchTo("second", async () => { switched = true; });
  expect(switched).toBe(true);
  expect(client.error).toBe("");
  client.dispose();
});
