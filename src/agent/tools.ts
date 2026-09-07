import { context, search, checkRevision } from "./context.ts";
import { recipes, writingExport, writingChanges } from "./writing.ts";
import { takePlacements } from "../song/media.ts";
import type { Take } from "../song/model.ts";
import { fretPositions } from "../song/fretted.ts";
import { tablature } from "../song/tablature.ts";
import {
  harmonicContext,
  chordCandidates,
  soundingHarmony,
  harmonicSpans,
} from "../song/harmony-analysis.ts";
import { voiceLeading } from "../song/voice-leading.ts";
import type { Pitch } from "../song/model.ts";
import {
  alignmentMap,
  comparePatterns,
  polyrhythmGrid,
} from "../song/rhythm-analysis.ts";
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
  { name:"search", description:"Bounded entity name/ID search. Args table,query,offset,limit (1–50),songId,expectedRevision. Returns IDs/names/count/nextOffset; read by ID for detail." },
  { name:"receipt", description:"Read one durable operation's full before/after deltas. Args operationId, optional songId/expectedRevision." },
  { name:"prompt_recipes", description:"Editable starting requests based on prior songwriting workflows. Save/adapt as prompts via normal CRUD; never auto-runs." },
  { name:"writing_export", description:"Portable JSON of project writing guidance and reusable prompts; excludes music and task history." },
  { name:"writing_import", description:"Replace writing guidance/prompts from portable JSON. Args text,songId,expectedRevision,operationId. Validated, atomic and undoable." },
  {
    name: "media_status",
    description:
      "Local audio metadata, capture states and missing song assets. Does not return binary data.",
  },
  {
    name: "media_import",
    description:
      "Stage audio before attaching it. Args:name,mime,base64. SHA256 identity; max25 MiB/10 minutes; browser decoding validates audio. Returns asset metadata.",
  },
  {
    name: "media_attach",
    description:
      "Atomically attach staged asset metadata and a new take. Args:assetId,take,expectedRevision,operationId. Failed attachment retains binary media for retry.",
  },
  {
    name: "media_asset",
    description:
      "Read encoded audio. Args:id. Returns asset metadata and base64.",
  },
  {
    name: "media_remove_unused",
    description:
      "Delete unreferenced binary media only after checking songs, all history, deleted snapshots and captures. Args:id.",
  },
  {
    name: "bundle_export",
    description:
      "Export complete song/media JSON bundle; errors if media is missing/corrupt. Max50 MiB audio. Plain export has metadata only.",
  },
  {
    name: "bundle_import",
    description:
      "Verify and stage a complete bundle, then import song. Args:text,asCopy,operationId. ID conflicts retain staged audio without overwriting music.",
  },
  {
    name: "recording_start",
    description:
      "Explicitly request microphone capture. Args:name,partId,sectionId,start exact quarters. Browser permission required; result requesting is not recording. Inspect media_status; only one capture per origin.",
  },
  {
    name: "recording_stop",
    description:
      "Stop or cancel pending permission, await final chunks and durable preparation. Inspect status/error before claiming readiness.",
  },
  {
    name: "capture_recover",
    description:
      "Recover saved chunks after interruption, or retry saving in-memory capture. Args:id. Does not take over active recording.",
  },
  {
    name: "capture_export",
    description:
      "Download captured bytes, even if incomplete codec data cannot decode. Args:id. Returns MIME/base64.",
  },
  {
    name: "capture_discard",
    description:
      "Explicitly delete capture checkpoints/raw chunks, retaining any separately stored audio asset. Args:id.",
  },
  {
    name: "fret_positions",
    description:
      "All in-range string/fret choices. Args: arrangementId, occurrenceId, eventId, memberId (null for note). Notes stay relative; no octave substitution.",
  },
  {
    name: "tablature",
    description:
      "Timed positions and conflicts across voices. Args: arrangementId, from/until exact quarters. Includes stale/unassigned notes, string collisions, technique connections and hand-span warnings. Display max512; total/truncated explicit. Full diagnostics bounded to5000 notes.",
  },
  {
    name: "harmonic_context",
    description:
      "Read active local/global harmonic region at exact at:[n,d]. Context is annotation; notes remain song-relative.",
  },
  {
    name: "sounding_harmony",
    description:
      "Read sounding pitches by voice and interpretation alternatives at exact at:[n,d], including releases, pedals, rests and member performance.",
  },
  {
    name: "chord_candidates",
    description:
      "Exact pitch-class interpretation alternatives. Args: chordId, optional tonic:Pitch and mode. Defaults to chord labelTonic. Does not edit or force a label.",
  },
  {
    name: "voice_leading",
    description:
      "Minimum semitone motion by octave placement, with matched/added/removed members. Args: sourceId,targetId,octaveRadius:0..2; 1–8 notes per chord. Read-only; apply via harmony voiceLead.",
  },
  {
    name: "compare_patterns",
    description:
      "Compare patterns by stable event origin. Args: sourceId, variationId. Returns same-scale cycle/group and note/rhythm differences; unrelated legacy events appear added/removed.",
  },
  {
    name: "alignments",
    description:
      "Exact cycle map for 2–8 occurrenceIds over inclusive from/until, expanded through arrangement. Bounded starts and common points, totals and truncation flag.",
  },
  {
    name: "polyrhythm_grid",
    description:
      "Inspect a declaration by id: expected versus actual base attacks for every appearance, missing/extra and match status. Chord-member attacks excluded.",
  },
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
      'Atomically edit the song. Args: songId, expectedRevision, operationId, label, command. command={kind:"edit",changes:[{table,id,value}]} (null deletes); table="meta" edits title/mode/tempo/arrangementOrder. Or kind:"harmony",action (see schema.harmonyActions and harmonyRecipe); kind:"rhythm",action (see schema.rhythmActions); kind:"structure",action (see schema.structuralActions); kind:"replace",song; kind:"delete"; kind:"undo",targetId. Read/export a song to discover entity shapes.',
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
    case "media_status":
      return c.media.status();
    case "media_import":
      return c.media.importAudio(
        String(args.name),
        String(args.mime),
        String(args.base64),
      );
    case "media_attach":
      return c.media.attach(
        String(args.assetId),
        args.take as Take,
        Number(args.expectedRevision),
        String(args.operationId),
      );
    case "media_asset":
      return c.media.exportAsset(String(args.id));
    case "media_remove_unused":
      await c.media.library.removeUnused(String(args.id));
      c.notify();
      return { removed: true };
    case "bundle_export":
      return c.media.exportBundle();
    case "bundle_import":
      return c.media.importBundle(
        String(args.text),
        Boolean(args.asCopy),
        String(args.operationId),
      );
    case "recording_start":
      return c.media.start({
        name: String(args.name),
        partId: String(args.partId),
        sectionId: args.sectionId as string | null,
        start: args.start as Time,
      });
    case "recording_stop":
      await c.media.recorder.stop();
      return c.media.status();
    case "capture_recover":
      return c.media.recorder.recover(String(args.id));
    case "capture_export":
      return c.media.rawCapture(String(args.id));
    case "capture_discard":
      await c.media.recorder.discard(String(args.id));
      return { discarded: true };
    case "fret_positions":
      if (!c.song) throw new Error("Open a song");
      return fretPositions(
        c.song,
        String(args.arrangementId),
        String(args.occurrenceId),
        String(args.eventId),
        args.memberId as string | null,
      );
    case "tablature":
      if (!c.song) throw new Error("Open a song");
      return tablature(
        c.song,
        String(args.arrangementId),
        args.from as Time,
        args.until as Time,
      );
    case "harmonic_context":
      if (!c.song) throw new Error("Open a song");
      return harmonicContext(c.song, args.at as Time);
    case "sounding_harmony":
      if (!c.song) throw new Error("Open a song");
      return soundingHarmony(c.song, args.at as Time);
    case "chord_candidates":
      if (!c.song) throw new Error("Open a song");
      return chordCandidates(
        c.song,
        String(args.chordId),
        args.tonic as Pitch | undefined,
        args.mode as string | undefined,
      );
    case "voice_leading":
      if (!c.song) throw new Error("Open a song");
      return voiceLeading(
        c.song,
        String(args.sourceId),
        String(args.targetId),
        Number(args.octaveRadius),
      );
    case "compare_patterns":
      if (!c.song) throw new Error("Open a song");
      return comparePatterns(
        c.song,
        String(args.sourceId),
        String(args.variationId),
      );
    case "alignments":
      if (!c.song) throw new Error("Open a song");
      return alignmentMap(
        c.song,
        args.occurrenceIds as string[],
        args.from as Time,
        args.until as Time,
      );
    case "polyrhythm_grid":
      if (!c.song) throw new Error("Open a song");
      return polyrhythmGrid(c.song, String(args.id));
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
    case "context": return context(c, args, capabilities);
    case "search": return search(c, args);
    case "receipt":
      await c.refresh(); checkRevision(c,args);
      return c.current?.history.find(h => h.operationId === args.operationId) ?? null;
    case "prompt_recipes": return recipes;
    case "writing_export":
      if (!c.song) throw new Error("Open a song");
      return writingExport(c.song);
    case "writing_import":
      if (!c.song) throw new Error("Open a song");
      return c.mutate({ songId:String(args.songId), expectedRevision:Number(args.expectedRevision), operationId:String(args.operationId ?? ""), label:"Import writing guidance", command:{kind:"edit",changes:writingChanges(c.song,String(args.text))} });
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
