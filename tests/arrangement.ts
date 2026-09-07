import { acceptance } from "./acceptance.ts";
export function arrangementSong(id = "arranged") {
  const s = acceptance(id);
  s.title = "Sections in conversation";
  s.tables.arrangement.verse!.name = "A";
  s.tables.arrangement.turn!.name = "B";
  for (const id of ["guitar", "drums"]) {
    s.tables.occurrences[id]!.sectionId = "verse";
    s.tables.occurrences[id]!.span = [16, 1];
  }
  s.tables.phrases.question = {
    id: "question",
    name: "Question",
    sectionId: "verse",
    start: [0, 1],
    duration: [8, 1],
  };
  s.tables.lyrics.words = {
    id: "words",
    name: "Opening words",
    sectionId: "verse",
    start: [1, 2],
    duration: [3, 1],
    text: "Count the spaces\nbetween us",
    phraseId: "question",
    partId: "guitar",
  };
  return s;
}
