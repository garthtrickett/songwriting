import { describe, expect, test } from "bun:test";
import { AgentClient, agentView, type AgentTransport } from "./agent.ts";

const task = { id: "t", status: "interrupted", prompt: "Rename", model: "anthropic:test", message: "Resume when ready", rounds: 2 };
describe("desktop agent boundary", () => {
  test("rejects malformed tasks without assuming checkpoint.items exists", () => {
    expect(() => agentView({ configuredModel: null, task: {} })).toThrow();
    expect(() => agentView({ configuredModel: null })).toThrow();
    expect(agentView({ configuredModel: null, task }).task?.message).toBe("Resume when ready");
  });
  test("transport/provider errors remain visible and do not become rejected polling promises", async () => {
    const transport: AgentTransport = { status: async () => ({ configuredModel: null, task }),
      configure: async () => {}, start: async () => { throw { code: "configuration", message: "Configure key" }; }, resume: async () => {}, cancel: async () => {} };
    const client = new AgentClient(transport);
    expect(await client.start("Rename")).toBe(false);
    expect(client.error).toBe("Configure key"); expect(client.busy).toBe(false);
    transport.status = async () => { throw new Error("Disconnected"); };
    await client.refresh(); expect(client.error).toContain("Disconnected"); client.dispose();
  });
  test("cancel targets the task identity and refreshes saved status", async () => {
    let status = task.status; const ids: string[] = [];
    const transport: AgentTransport = { status: async () => ({ configuredModel: "anthropic:test", task: { ...task, status } }),
      configure: async () => {}, start: async () => {}, resume: async () => {}, cancel: async (id) => { ids.push(id); status = "cancelled"; } };
    const client = new AgentClient(transport);
    await client.refresh(); expect(await client.cancel("t")).toBe(true);
    expect(ids).toEqual(["t"]); expect(client.state.task?.status).toBe("cancelled"); client.dispose();
  });
});
