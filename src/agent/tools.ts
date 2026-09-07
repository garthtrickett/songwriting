import { previewCommand } from "../song/commands.ts";
import { sectionSpans, placements, annotations } from "../song/arrangement.ts";
import { historyStacks } from "../song/history.ts";
import type { Controller, Selection } from "../app/controller.ts";
import type { Mutation, Command } from "../song/commands.ts";
import { save } from "../storage/projects.ts";
import { schema } from "./schema.ts";
import { alignment, bars, sounds } from "../song/timeline.ts";
import { TABLES, type Table } from "../song/model.ts";
import { cmp, type Time } from "../song/time.ts";
export const capabilities = [
  {
    name: "preview",
    description:
      "Preview any command without saving. Args: command. Returns revision, changed entities, section positions and fixed global placements.",
  },
  {
    name: "navigate",
    description:
      "Set transient timeline zoom (4–128 px/quarter) and/or jump to appearanceId. Args: zoom?, appearanceId?.",
  },
  {
    name: "schema",
    description:
      "Read document templates, validation conventions, and tool argument schemas.",
  },
  {
    name: "context",
    description:
      "Read songs, current song ID/revision/selection, available tables and commands.",
  },
  {
    name: "read",
    description:
      "Read current song, a table/entity, or sounding events in a time range. Args: table?, id?, from?:[n,d], until?:[n,d].",
  },
  {
    name: "create_song",
    description: "Create and open an empty song. Args: title.",
  },
  { name: "open_song", description: "Open song by id." },
  {
    name: "select",
    description: "Set editor selection. Args: table, id; or null selection.",
  },
  {
    name: "mutate",
    description:
      'Atomically edit the song. Args: songId, expectedRevision, operationId, label, command. command={kind:"edit",changes:[{table,id,value}]} (null deletes); table="meta" edits title/mode/tempo/arrangementOrder. Or kind:"structure",action (see schema.structuralActions); kind:"replace",song; kind:"delete"; kind:"undo",targetId. Read/export a song to discover entity shapes.',
  },
  {
    name: "alignment",
    description:
      "Next shared cycle start. Args: occurrenceIds:string[], after:[n,d], until:[n,d].",
  },
  { name: "export", description: "Read canonical song JSON." },
  {
    name: "import",
    description:
      "Import song JSON. Args: text, asCopy:boolean. Existing IDs are rejected unless imported as a new copy.",
  },
  {
    name: "transport",
    description:
      "Audition control. Args: action=play|stop|seek|settings; position?:number (quarter notes), tonic?:number (MIDI tonic), metronome?:boolean.",
  },
];
export async function executeTool(
  c: Controller,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  switch (name) {
    case "preview":
      if (!c.current) throw new Error("Open a song");
      return previewCommand(c.current, args.command as Command);
    case "navigate":
      c.navigate(
        Number(args.zoom ?? c.zoom),
        args.appearanceId === undefined ? undefined : String(args.appearanceId),
      );
      return { zoom: c.zoom, jumpTo: c.jumpTo, selection: c.selection };
    case "schema":
      return schema();
    case "context":
      await c.refresh();
      return {
        deletedSongs: c.deletedSongs.map((e) => ({
          id: e.id,
          revision: e.revision,
          undoOperationId: e.history.at(-1)?.operationId,
        })),
        songs: c.songs.map((e) => ({
          id: e.id,
          title: e.song?.title,
          revision: e.revision,
        })),
        songId: c.current?.id,
        revision: c.current?.revision,
        selection: c.selection,
        viewport: { zoom: c.zoom, jumpTo: c.jumpTo },
        sections: c.song ? sectionSpans(c.song) : [],
        undoRedo: historyStacks(c.current?.history ?? []),
        tables: TABLES,
        examples: [
          {
            name: "Turning rooms",
            url: "/turning-rooms.song.json",
            description:
              "A–B–A′ with local patterns, phrases, lyrics and a global bass. Authored by a live agent.",
          },
          {
            name: "Countercurrent",
            url: "/countercurrent.song.json",
            description:
              "Editable seven/eight composition; fetch its JSON and import it as a copy.",
          },
        ],
        capabilities,
        history: c.current?.history.map((h) => ({
          operationId: h.operationId,
          label: h.label,
          revision: h.revision,
          affected: h.deltas.map((d) => ({ table: d.table, id: d.id })),
        })),
        transport: {
          playing: c.audio.playing,
          position: c.audio.position,
          tonic: c.audio.tonic,
          metronome: c.audio.metronome,
        },
      };
    case "read": {
      if (!c.song) throw new Error("Open a song");
      if (args.from && args.until)
        return {
          bars: bars(c.song),
          sections: sectionSpans(c.song),
          placements: placements(c.song),
          annotations: annotations(c.song).filter(
            (e) =>
              cmp(e.start, args.from as Time) >= 0 &&
              cmp(e.start, args.until as Time) < 0,
          ),
          events: sounds(c.song).filter(
            (e) =>
              cmp(e.start, args.from as Time) >= 0 &&
              cmp(e.start, args.until as Time) < 0,
          ),
        };
      if (args.table) {
        if (!TABLES.includes(args.table as Table))
          throw new Error("Unknown table");
        const table = c.song.tables[args.table as Table];
        return args.id ? (table[String(args.id)] ?? null) : table;
      }
      return c.song;
    }
    case "create_song":
      return c.create(
        String(args.title ?? "Untitled idea"),
        String(args.songId ?? crypto.randomUUID()),
        String(args.operationId ?? crypto.randomUUID()),
      );
    case "open_song":
      await c.open(String(args.id));
      return { songId: c.current?.id, revision: c.current?.revision };
    case "select": {
      const selection = args.table
        ? { table: args.table as Table, id: String(args.id) }
        : null;
      if (
        selection &&
        (!TABLES.includes(selection.table) ||
          !c.song?.tables[selection.table][selection.id])
      )
        throw new Error("Selection does not exist");
      c.select(selection);
      return selection;
    }
    case "mutate":
      return c.mutate(args as unknown as Mutation);
    case "alignment":
      if (!c.song) throw new Error("Open a song");
      return {
        at: alignment(
          c.song,
          args.occurrenceIds as string[],
          args.after as Time,
          args.until as Time,
        ),
      };
    case "export":
      return c.export();
    case "import":
      return c.import(
        String(args.text),
        Boolean(args.asCopy),
        String(args.operationId ?? crypto.randomUUID()),
      );
    case "transport": {
      if (args.action === "stop") c.audio.stop();
      else if (args.action === "seek") {
        const p = Number(args.position);
        if (!Number.isFinite(p) || p < 0)
          throw new Error("Position must be nonnegative");
        c.audio.seek(p);
      } else if (args.action === "settings") {
        if (args.tonic !== undefined) {
          if (
            !Number.isInteger(args.tonic) ||
            Number(args.tonic) < 12 ||
            Number(args.tonic) > 96
          )
            throw new Error("Tonic must be MIDI 12–96");
          c.audio.tonic = Number(args.tonic);
        }
        if (args.metronome !== undefined)
          c.audio.metronome = Boolean(args.metronome);
      } else if (args.action === "play") {
        if (!c.song) throw new Error("Open a song");
        await c.audio.play(c.song, c.audio.position);
      } else throw new Error("Unknown transport action");
      await save(c.db, "settings", {
        id: "audio",
        tonic: c.audio.tonic,
        metronome: c.audio.metronome,
      });
      c.notify();
      return { playing: c.audio.playing, position: c.audio.position };
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}
export type { Selection, Command };
