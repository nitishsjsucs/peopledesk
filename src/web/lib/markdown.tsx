// Restricted markdown -> React elements. Supports what the policy corpus uses: front matter (skipped),
// #/##/### headings, "- " bullet lists, paragraphs, **bold** and `code`. Everything is emitted as React
// text nodes, so markdown from R2 can never reach the DOM as raw HTML (no innerHTML anywhere).
import type { ReactNode } from "react";

type Block = { type: "h1" | "h2" | "h3" | "p"; text: string } | { type: "ul"; items: string[] };

export function stripFrontMatter(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0] !== "---") return lines.join("\n");
  const end = lines.indexOf("---", 1);
  return end === -1 ? lines.join("\n") : lines.slice(end + 1).join("\n");
}

export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "p", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: "ul", items: list });
    list = null;
  };
  for (const raw of stripFrontMatter(markdown).split("\n")) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = (heading[1] as string).length as 1 | 2 | 3;
      blocks.push({ type: `h${level}`, text: heading[2] as string });
      continue;
    }
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (item) {
      flushParagraph();
      (list ??= []).push(item[1] as string);
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** **bold** and `code` spans; everything else is plain text. */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const token = m[0];
    out.push(token.startsWith("**") ? <strong key={i++}>{token.slice(2, -2)}</strong> : <code key={i++}>{token.slice(1, -1)}</code>);
    last = idx + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className="markdown">
      {parseBlocks(source).map((b, i) => {
        switch (b.type) {
          case "h1":
            return <h1 key={i}>{renderInline(b.text)}</h1>;
          case "h2":
            return <h2 key={i}>{renderInline(b.text)}</h2>;
          case "h3":
            return <h3 key={i}>{renderInline(b.text)}</h3>;
          case "ul":
            return (
              <ul key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ul>
            );
          default:
            return <p key={i}>{renderInline(b.text)}</p>;
        }
      })}
    </div>
  );
}
