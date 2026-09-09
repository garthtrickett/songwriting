import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Transport } from "./client.ts";
export const nativeTransport: Transport = {
  open: () => invoke("desktop_open"),
  dispatch: (request) => invoke("desktop_dispatch", { request }),
  listen: (changed) => listen("desktop-state", (event) => changed(event.payload)),
};
