import type { Song, Writing, Prompt } from "../song/model.ts";
import type { Change } from "../song/commands.ts";
export const recipes = [
  {
    id: "variation",
    name: "Develop an independent reply",
    text: "Develop an independent variation of the selected riff, one eighth note shorter. Preserve its source, the held bass and recorded takes. Inspect the effect, make the change and verify the preserved music before finishing.",
  },
  {
    id: "playability",
    name: "Review playable positions",
    text: "Inspect this song's guitar and bass arrangements for unassigned or incompatible positions and connected techniques. Explain the affected notes and suggest playable alternatives without changing the relative composition.",
  },
  {
    id: "takes",
    name: "Review recorded ideas",
    text: "Review recorded takes against section boundaries and repeated appearances. Preserve original audio, pitch and trims. Summarize missing media and placement choices; make only changes I request.",
  },
];
export const writingExport = (s: Song) =>
  JSON.stringify(
    {
      format: "songwriting-writing",
      version: 1,
      writing: s.writing,
      prompts: s.tables.prompts,
    },
    null,
    2,
  );
export function writingChanges(s: Song, text: string): Change[] {
  const x = JSON.parse(text) as {
    format: string;
    version: number;
    writing: Writing;
    prompts: Record<string, Prompt>;
  };
  if (
    x?.format !== "songwriting-writing" ||
    x.version !== 1 ||
    !x.prompts ||
    typeof x.prompts !== "object" ||
    Array.isArray(x.prompts)
  )
    throw new Error("Invalid writing bundle");
  return [
    { table: "meta", id: "writing", value: x.writing },
    ...[
      ...new Set([...Object.keys(s.tables.prompts), ...Object.keys(x.prompts)]),
    ].map((id) => ({
      table: "prompts" as const,
      id,
      value: x.prompts[id] ?? null,
    })),
  ];
}
