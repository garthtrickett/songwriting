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
