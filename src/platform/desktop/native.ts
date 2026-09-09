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
