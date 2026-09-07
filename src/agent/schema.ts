import { emptySong, noteEvent } from "../song/model.ts";
export function schema() {
  const entity = (id: string, name: string) => ({ id, name });
  return {
    schemaVersion: 1,
    time: {
      type: "array",
      items: { type: "integer" },
      minItems: 2,
      maxItems: 2,
      description:
        "Normalized [numerator, positive denominator], exact quarter-note units. Safe integers only.",
    },
    document: emptySong("song-id", "Title"),
    conventions: {
      pitch:
        "Degree 1–7, alteration -4…4, octave -5…5, relative to major reference. Bounds are this prototype's supported pitch range.",
      edits:
        "Put the full entity value at table/id; null removes it. Multiple changes are atomic. Read current revision before writing. Invalid references return a rejection. Chord pitch changes clear an unchanged old label.",
      meter:
        "Changing bars changes the meter map, preserving absolute event positions. Pattern starts are independent of bars.",
      references:
        "IDs in voice.partId, event.patternId/chordId, occurrence.patternId/voiceId, section.barIds, bar.sectionId, arrangement.sectionId and pattern.sourceId must exist.",
    },
    templates: {
      parts: {
        ...entity("part", "Guitar"),
        instrument: "guitar",
        volume: 0.6,
        muted: false,
      },
      voices: { ...entity("voice", "Upper line"), partId: "part" },
      patterns: {
        ...entity("pattern", "Riff"),
        length: [7, 2],
        sourceId: null,
      },
      chords: {
        ...entity("chord", "Tonic"),
        label: "I",
        notes: [
          { id: "root", pitch: { degree: 1, alteration: 0, octave: 0 } },
          { id: "third", pitch: { degree: 3, alteration: 0, octave: 0 } },
          { id: "fifth", pitch: { degree: 5, alteration: 0, octave: 0 } },
        ],
      },
      events: noteEvent("event", "pattern"),
      sections: { ...entity("section", "Verse"), barIds: ["bar"] },
      bars: {
        ...entity("bar", "Bar 1"),
        sectionId: "section",
        numerator: 7,
        denominator: 8,
        groups: [2, 2, 3],
        actual: null,
      },
      arrangement: { ...entity("section-once", "Verse"), sectionId: "section" },
      occurrences: {
        ...entity("occurrence", "Riff in guitar"),
        patternId: "pattern",
        voiceId: "voice",
        start: [0, 1],
        span: [28, 1],
        phase: [0, 1],
        boundary: "continue",
        tails: "ring",
      },
      markers: { ...entity("marker", "Together"), at: [28, 1] },
    },
    toolArguments: {
      mutate: {
        type: "object",
        required: [
          "songId",
          "expectedRevision",
          "operationId",
          "label",
          "command",
        ],
        properties: {
          songId: { type: "string" },
          expectedRevision: { type: "integer", minimum: 0 },
          operationId: { type: "string" },
          label: { type: "string" },
          command: {
            oneOf: [
              {
                type: "object",
                required: ["kind", "changes"],
                properties: {
                  kind: { const: "edit" },
                  changes: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["table", "id", "value"],
                      properties: {
                        table: { type: "string" },
                        id: { type: "string" },
                        value: {},
                      },
                    },
                  },
                },
              },
              {
                type: "object",
                required: ["kind", "song"],
                properties: {
                  kind: { const: "replace" },
                  song: { type: "object" },
                },
              },
              {
                type: "object",
                required: ["kind"],
                properties: { kind: { const: "delete" } },
              },
              {
                type: "object",
                required: ["kind", "targetId"],
                properties: {
                  kind: { const: "undo" },
                  targetId: { type: "string" },
                },
              },
            ],
          },
        },
      },
      read: {
        type: "object",
        properties: {
          table: { type: "string" },
          id: { type: "string" },
          from: { type: "array" },
          until: { type: "array" },
        },
      },
      alignment: {
        type: "object",
        required: ["occurrenceIds", "after", "until"],
        properties: {
          occurrenceIds: { type: "array", items: { type: "string" } },
          after: { type: "array" },
          until: { type: "array" },
        },
      },
      create_song: {
        type: "object",
        properties: {
          title: { type: "string" },
          songId: { type: "string" },
          operationId: { type: "string" },
        },
      },
    },
  };
}
