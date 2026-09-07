import "./style.css";
import { openDb } from "./storage/projects.ts";
import { Controller } from "./app/controller.ts";
import { mount } from "./app/view.ts";
import { connection } from "./agent/connection.ts";
import { executeTool } from "./agent/tools.ts";
const root = document.getElementById("app")!;
try {
  const c = new Controller(await openDb());
  await c.init();
  const agent = connection(c);
  const unmount = mount(root, c, agent);
  agent.start();
  // The documented in-page interface is the same one the agent bridge calls.
  Object.assign(window, {
    songwriting: {
      tool: (name: string, args?: Record<string, unknown>) =>
        executeTool(c, name, args),
      controller: c,
    },
  });
  addEventListener("pagehide", () => {
    agent.stop();
    c.audio.stop();
    void c.media.recorder.stop();
  });
  addEventListener("pageshow", (e) => {
    if ((e as PageTransitionEvent).persisted) location.reload();
  });
} catch (e) {
  root.textContent = `Could not open your local songbook: ${String(e)}`;
}
