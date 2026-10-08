// markdown -> section chunks. One chunk per `##` section; the title and the section name are kept as
// separate FTS columns. Shared by the seed statements and the tests, so the indexed text and the
// manifest text are produced by the same code.
import { chunkId } from "../domain.ts";

export type Chunk = {
  chunkId: string;
  docId: string;
  version: number;
  ordinal: number;
  title: string;
  section: string;
  text: string;
};

export function chunkMarkdown(markdown: string, meta: { docId: string; version: number; title: string }): Chunk[] {
  const lines = markdown.split("\n");
  let i = 0;
  // Skip front matter.
  if (lines[0] === "---") {
    i = 1;
    while (i < lines.length && lines[i] !== "---") i++;
    i++;
  }
  const chunks: Chunk[] = [];
  let section: string | null = null;
  let body: string[] = [];
  const flush = () => {
    if (section === null) return;
    const text = body.join("\n").trim();
    if (text.length > 0) {
      const ordinal = chunks.length + 1;
      chunks.push({
        chunkId: chunkId(meta.docId, meta.version, ordinal),
        docId: meta.docId,
        version: meta.version,
        ordinal,
        title: meta.title,
        section,
        text,
      });
    }
  };
  for (; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.startsWith("## ")) {
      flush();
      section = line.slice(3).trim();
      body = [];
    } else if (section !== null) {
      body.push(line);
    }
  }
  flush();
  return chunks;
}
