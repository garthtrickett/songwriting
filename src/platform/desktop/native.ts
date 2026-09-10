import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Transport } from "./client.ts";
export const nativeTransport: Transport = {
  open: () => invoke("desktop_open"),
  dispatch: (request) => invoke("desktop_dispatch", { request }),
  listen: (changed) => listen("desktop-state", (event) => changed(event.payload)),
};

import type { AgentTransport } from "./agent.ts";
export const nativeAgentTransport: AgentTransport = {
  status: () => invoke("desktop_agent_status"),
  configure: (config) => invoke("desktop_agent_configure", { config }),
  start: (prompt) => invoke("desktop_agent_start", { prompt }),
  resume: (id) => invoke("desktop_agent_resume", { id }),
  cancel: (id) => invoke("desktop_agent_cancel", { id }),
};

import type { AudioTransport } from "./audio.ts";
export const nativeAudioTransport: AudioTransport = {
  status: () => invoke("desktop_audio_status"),
  devices: () => invoke("desktop_audio_devices"),
  play: (request) => invoke("desktop_audio_play", { request }),
  stop: () => invoke("desktop_audio_stop"),
};

import type { MediaTransport } from "./media.ts";
export const nativeMediaTransport: MediaTransport = {
  status: () => invoke("desktop_media_status"),
};

import type { ProfileView } from "../../generated/desktop/ProfileView.ts";
export interface ProfileTransport {
  list(): Promise<unknown>;
  create(id: string): Promise<unknown>;
  switchTo(id: string): Promise<unknown>;
}
export const nativeProfileTransport: ProfileTransport = {
  list: () => invoke("desktop_profiles"),
  create: (id) => invoke("desktop_profile_create", { id }),
  switchTo: (id) => invoke("desktop_profile_switch", { id }),
};
export function profileView(input: unknown): ProfileView {
  const v = input as ProfileView;
  if (!v || typeof v !== "object" || typeof v.id !== "string" || !v.id ||
      !(v.title === null || typeof v.title === "string") ||
      !(v.revision === null || (Number.isSafeInteger(v.revision) && (v.revision as number) >= 0))) throw new Error("Invalid profile");
  return v;
}
export function profileList(input: unknown): ProfileView[] {
  if (!Array.isArray(input)) throw new Error("Invalid profile list");
  return input.map(profileView);
}
