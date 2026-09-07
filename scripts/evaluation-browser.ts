import { chromium } from "@playwright/test";
const context = await chromium.launchPersistentContext(
  ".agent/evaluation-browser",
  { headless: true, viewport: { width: 1512, height: 1100 } },
);
const taskId = process.argv[2];
if (taskId) {
  const tasks = await Bun.file(".agent/tasks.json").json();
  const task = tasks.find((t: any) => t.id === taskId);
  if (!task) throw new Error("Unknown evaluation task");
  await context.addInitScript(
    (id: string) => sessionStorage.setItem("songwriting-client", id),
    task.clientId,
  );
}
const page = context.pages()[0] ?? (await context.newPage());
await page.goto("http://127.0.0.1:5188/");
await page.waitForFunction(() => Boolean((window as any).songwriting));
if (!taskId) {
  await page
    .getByLabel("Agent request")
    .fill(
      "Create an original math-rock sketch: a seven-eighth guitar cycle over an eight-eighth drum cycle, a sustained bass voice, mixed meters, and a chord whose members have independent releases. Mark the next shared cycle start. Then make a guitar variation one eighth shorter for the next section, preserving the bass and original riff. Save and verify the structure.",
    );
  await page.getByRole("button", { name: "Send to agent" }).click();
}
console.log(
  "Evaluation browser open; task submitted. This process keeps the live editor connected.",
);
setInterval(
  () =>
    void page
      .screenshot({ path: ".agent/editor.png", fullPage: true })
      .catch(() => {}),
  10000,
);
process.on("SIGTERM", () => void context.close().then(() => process.exit()));
await new Promise(() => {});
