import type { Controller } from "./controller.ts";
export function actions(c: Controller) {
  const handle = (fn: () => unknown) => async () => {
    try {
      const result = await fn();
      if (result && typeof result === "object" && "ok" in result && !result.ok)
        throw new Error(
          String("error" in result ? result.error : "Edit failed"),
        );
    } catch (e) {
      c.error = e instanceof Error ? e.message : String(e);
      c.notify();
    }
  };
  return handle;
}
