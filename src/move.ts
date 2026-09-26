/**
 * Planning a move: the text of every note whose links the move would break, rewritten so each link still resolves to
 * the note it resolved to before (ADR 0016). This is text only; the `Vault` checks the mask and writes the files.
 */
import { posix } from "node:path";
import { frontmatterSpans, LinkIndex, type LinkSpan, linkSpans } from "./links.ts";
import { WriteConflictError } from "./write.ts";

export interface MovingNote {
  path: string;
  raw: string;
  body: string;
}

const RELATIVE = /^\.\.?\//;

/** Characters that would end or break a Markdown link destination written without `<>`, percent-encoded. */
function encodeDestination(path: string): string {
  return path.replace(/[%\s()<>]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

function relativePath(fromNote: string, to: string): string {
  const path = posix.relative(posix.dirname(fromNote), to);
  return path.startsWith("../") ? path : `./${path}`;
}

/** The target text for a link at `source` that must resolve to `want` among `index`: the shortest that does. */
function rewrite(span: LinkSpan, raw: string, source: string, want: string, index: LinkIndex): string {
  const withExtension = /\.md$/i.test(span.target);
  const named = (path: string) => (withExtension ? path : path.replace(/\.md$/i, ""));
  const candidates =
    span.kind === "markdown" && RELATIVE.test(span.target)
      ? [named(relativePath(source, want))]
      : [named(posix.basename(want)), named(want)];
  for (const candidate of candidates) {
    const resolution = index.resolve(source, candidate);
    if (resolution.status !== "resolved" || resolution.path !== want) continue;
    return span.kind === "markdown" && raw[span.start - 1] !== "<" ? encodeDestination(candidate) : candidate;
  }
  throw new WriteConflictError(`cannot rewrite "${raw.slice(span.start, span.end)}" in ${source} to reach ${want}`);
}

/**
 * The new text of every note the move of `from` to `to` changes, by the note's current path. A link that resolved to
 * a note before the move, and would not resolve to that note's new place after it, is rewritten; its heading, block,
 * and display text are kept. That covers links to the moved note, the moved note's own relative links, and links to
 * another note whose name the move makes ambiguous. A relative link from the moved note to an attachment keeps
 * pointing at the same file. Links in code and raw HTML are not links, so they are untouched.
 */
export function planMove(notes: MovingNote[], from: string, to: string): Map<string, string> {
  const place = (path: string) => (path === from ? to : path);
  const before = new LinkIndex(notes.map((note) => note.path));
  const after = new LinkIndex(notes.map((note) => place(note.path)));
  const changed = new Map<string, string>();
  for (const note of notes) {
    const source = place(note.path);
    const bodyAt = note.raw.length - note.body.length;
    const spans = [
      ...frontmatterSpans(note.raw.slice(0, bodyAt)),
      ...linkSpans(note.body).map((span) => ({ ...span, start: span.start + bodyAt, end: span.end + bodyAt })),
    ];
    const edits: { start: number; end: number; text: string }[] = [];
    for (const span of spans) {
      const was = before.resolve(note.path, span.target);
      if (was.status === "resolved") {
        const want = place(was.path);
        const now = after.resolve(source, span.target);
        if (now.status === "resolved" && now.path === want) continue;
        edits.push({ start: span.start, end: span.end, text: rewrite(span, note.raw, source, want, after) });
      } else if (
        was.status === "asset" &&
        note.path === from &&
        span.kind === "markdown" &&
        RELATIVE.test(span.target)
      ) {
        const file = posix.normalize(posix.join(posix.dirname(from), span.target));
        const moved = relativePath(to, file);
        if (moved === span.target) continue;
        const text = note.raw[span.start - 1] === "<" ? moved : encodeDestination(moved);
        edits.push({ start: span.start, end: span.end, text });
      }
    }
    if (edits.length === 0) continue;
    let text = note.raw;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    }
    changed.set(note.path, text);
  }
  return changed;
}
