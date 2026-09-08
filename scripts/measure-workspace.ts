import { time } from "../src/song/time.ts";
import { chromium } from "@playwright/test";
import { emptySong, noteEvent } from "../src/song/model.ts";
const s = emptySong("dense-review", "Dense arrangement");
for (let p = 0; p < 16; p++) {
  const id = "p" + p;
  s.tables.parts[id] = {
    id,
    name: "Guitar " + (p + 1),
    instrument: "guitar",
    volume: 0.6,
    muted: false,
  };
  s.tables.voices[id] = { id, name: "Voice 1", partId: id };
  s.tables.patterns[id] = {
    id,
    name: "Pattern " + (p + 1),
    length: [16, 1],
    groups: [],
    sourceId: null,
  };
  for (let j = 0; j < 4; j++) {
    const oid = id + "o" + j;
    s.tables.occurrences[oid] = {
      id: oid,
      name: "Pass " + j,
      patternId: id,
      voiceId: id,
      sectionId: null,
      start: [j * 16, 1],
      span: [16, 1],
      phase: [0, 1],
      boundary: "continue",
      tails: "ring",
    };
  }
}
for (let i = 0; i < 1250; i++) {
  const pid = "p" + (i % 16),
    id = "e" + i;
  s.tables.events[id] = {
    ...noteEvent(id, pid),
    start: time(Math.floor(i / 16), 5),
    duration: [1, 7],
    pitch: {
      degree: (i % 7) + 1,
      alteration: i % 11 === 0 ? -1 : 0,
      octave: (i % 3) - 1,
    },
  };
}
s.tables.sections.a = { id: "a", name: "A", sourceId: null, barIds: [] };
for (let i = 0; i < 16; i++) {
  const id = "b" + i;
  s.tables.bars[id] = {
    id,
    name: "Bar " + i,
    sectionId: "a",
    numerator: 4,
    denominator: 4,
    groups: [1, 1, 1, 1],
    actual: null,
  };
  s.tables.sections.a.barIds.push(id);
}
s.tables.arrangement.a = { id: "a", name: "A", sectionId: "a" };
s.arrangementOrder = ["a"];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto("http://127.0.0.1:5188");
  await page.waitForFunction(() => Boolean((window as any).songwriting));
  await page.evaluate(async (s) => {
    await (window as any).songwriting.tool("import", {
      text: JSON.stringify(s),
      asCopy: false,
    });
  }, s);
  const result = await page.evaluate(async () => {
    const c = (window as any).songwriting.controller;
    const samples: number[] = [];
    for (let i = 0; i < 12; i++) {
      const start = performance.now();
      c.select({ table: "events", id: "e" + i });
      await new Promise(requestAnimationFrame);
      samples.push(performance.now() - start);
    }
    const frames: number[] = [];
    const scroll = document.querySelector(".score-scroll")!;
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      scroll.scrollLeft = i * 30;
      await new Promise(requestAnimationFrame);
      frames.push(performance.now() - start);
    }
    return {
      userAgent: navigator.userAgent,
      notes: document.querySelectorAll(".note-block").length,
      selectionMs: samples,
      panFrameMs: frames,
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
