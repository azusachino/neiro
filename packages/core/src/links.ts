import { posix } from "node:path";
import { codeFences } from "./sections.ts";

export interface WikiLink {
  /** The link target as written, without any `#heading` or `^block` suffix. */
  target: string;
  display?: string;
  embed: boolean;
}

export type Resolution =
  | { status: "resolved"; path: string }
  | { status: "missing" }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "asset" };

const LINK = /(!?)\[\[([^\]\n]+?)\]\]/g;
// `[text](target)`, `[text](<target with spaces>)`, and an optional `"title"`.
const MARKDOWN_LINK = /(!?)\[([^\]\n]*)\]\((<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\)/g;
// A URL scheme such as `https:` or `obsidian:` marks a link that leaves the vault.
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BLOCK_TAGS =
  "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|" +
  "fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|" +
  "menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
// CommonMark's HTML block starts, each with the line that ends it; null ends the block at a blank line.
const HTML_BLOCKS: [RegExp, RegExp | null][] = [
  [/^ {0,3}<(?:script|pre|style|textarea)(?:[\s>]|$)/i, /<\/(?:script|pre|style|textarea)>/i],
  [/^ {0,3}<!--/, /-->/],
  [/^ {0,3}<\?/, /\?>/],
  [/^ {0,3}<![A-Za-z]/, />/],
  [/^ {0,3}<!\[CDATA\[/, /\]\]>/],
  [new RegExp(`^ {0,3}</?(?:${BLOCK_TAGS})(?:\\s|/?>|$)`, "i"), null],
];
// Any other complete tag alone on a line starts a block too, but cannot interrupt a paragraph.
const LONE_TAG =
  /^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>)\s*$/;

/** A line-by-line tracker of the lines Obsidian renders no links in: fenced code and raw HTML blocks. */
function rawLines(): (line: string) => boolean {
  const inFence = codeFences();
  let end: RegExp | null | undefined;
  let paragraph = false;
  return (line) => {
    const blank = line.trim() === "";
    if (end !== undefined) {
      if (end === null ? blank : end.test(line)) end = undefined;
      paragraph = false;
      return true;
    }
    if (inFence(line)) {
      paragraph = false;
      return true;
    }
    const start =
      HTML_BLOCKS.find(([open]) => open.test(line)) ??
      (!paragraph && LONE_TAG.test(line) ? [LONE_TAG, null] : undefined);
    if (start) {
      const close = start[1];
      end = close?.test(line) ? undefined : close;
      paragraph = false;
      return true;
    }
    paragraph = !blank;
    return false;
  };
}

/** A line without its code spans: a run of backticks closes only on a run of the same length, else it is text. */
function withoutCodeSpans(line: string): string {
  let text = "";
  let from = 0;
  const run = /`+/g;
  for (let open = run.exec(line); open; open = run.exec(line)) {
    const close = new RegExp(`(?<!\`)\`{${open[0].length}}(?!\`)`, "g");
    close.lastIndex = run.lastIndex;
    if (!close.exec(line)) continue;
    text += line.slice(from, open.index);
    from = run.lastIndex = close.lastIndex;
  }
  return text + line.slice(from);
}

/** Every wikilink and local Markdown link in a Markdown body, skipping code and raw HTML. */
export function extractLinks(body: string): WikiLink[] {
  const links: WikiLink[] = [];
  const isRaw = rawLines();
  for (const line of body.split("\n")) {
    // Every line feeds the block state, but most hold no link; skip the link patterns for those.
    if (isRaw(line) || !line.includes("[")) continue;
    const text = line.includes("`") ? withoutCodeSpans(line) : line;
    links.push(...wikilinks(text));
    if (text.includes("](")) links.push(...markdownLinks(text.replace(LINK, "")));
  }
  return links;
}

/** The wikilinks in frontmatter values, such as `related: "[[Note]]"`, which Obsidian counts as links. */
export function frontmatterLinks(data: Record<string, unknown>): WikiLink[] {
  const strings = (value: unknown): string[] =>
    typeof value === "string"
      ? [value]
      : Array.isArray(value)
        ? value.flatMap(strings)
        : typeof value === "object" && value !== null
          ? Object.values(value).flatMap(strings)
          : [];
  return strings(data).flatMap(wikilinks);
}

function wikilinks(text: string): WikiLink[] {
  const links: WikiLink[] = [];
  for (const match of text.matchAll(LINK)) {
    const inner = match[2] ?? "";
    // Table cells escape the alias pipe as `\|`.
    const pipe = inner.search(/\\?\|/);
    const rawTarget = pipe === -1 ? inner : inner.slice(0, pipe);
    const display =
      pipe === -1
        ? undefined
        : inner
            .slice(pipe)
            .replace(/^\\?\|/, "")
            .trim();
    const target = rawTarget.replace(/[#^].*$/, "").trim();
    if (target === "") continue;
    links.push({ target, embed: match[1] === "!", ...(display ? { display } : {}) });
  }
  return links;
}

/** Markdown links to vault files; Obsidian writes their targets URL-encoded, as `My%20Note.md`. */
function markdownLinks(text: string): WikiLink[] {
  const links: WikiLink[] = [];
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const written = (match[3] ?? "").replace(/^<|>$/g, "");
    if (SCHEME.test(written)) continue;
    let target = written.replace(/#.*$/, "");
    try {
      target = decodeURIComponent(target);
    } catch {
      // A stray `%` is part of the name.
    }
    target = target.trim();
    if (target === "") continue;
    const display = match[2]?.trim();
    links.push({ target, embed: match[1] === "!", ...(display ? { display } : {}) });
  }
  return links;
}

/** Lookup tables over vault-relative note paths (`note/a/b.md`). */
export class LinkIndex {
  private readonly byPath = new Map<string, string>();
  private readonly byStem = new Map<string, string[]>();

  constructor(paths: Iterable<string>) {
    for (const path of paths) {
      const key = path.replace(/\.md$/i, "").toLowerCase();
      this.byPath.set(key, path);
      const stem = posix.basename(key);
      this.byStem.set(stem, [...(this.byStem.get(stem) ?? []), path]);
    }
  }

  /** Resolve a link target the way Obsidian does: relative, vault-root path, path suffix, then unique stem; an unmatched target with a file extension is an attachment. */
  resolve(fromPath: string, target: string): Resolution {
    const resolution = this.lookup(fromPath, target.replace(/\.md$/i, "").toLowerCase());
    // A name such as `Node.js` is a note when one exists; only an unmatched extension names an attachment.
    const extension = /\.[a-z0-9]+$/i.test(target) && !/\.md$/i.test(target);
    return extension && resolution.status === "missing" ? { status: "asset" } : resolution;
  }

  private lookup(fromPath: string, wanted: string): Resolution {
    if (wanted.startsWith("./") || wanted.startsWith("../")) {
      const key = posix.normalize(posix.join(posix.dirname(fromPath.toLowerCase()), wanted));
      return this.found(this.byPath.get(key));
    }
    if (wanted.includes("/")) {
      const exact = this.byPath.get(wanted.replace(/^\//, ""));
      if (exact) return { status: "resolved", path: exact };
      const beside = this.byPath.get(posix.join(posix.dirname(fromPath.toLowerCase()), wanted));
      if (beside) return { status: "resolved", path: beside };
      const suffix = [...this.byPath.entries()].filter(([key]) => key.endsWith(`/${wanted}`)).map(([, path]) => path);
      return this.pick(fromPath, suffix);
    }
    return this.pick(fromPath, this.byStem.get(wanted) ?? []);
  }

  private found(path: string | undefined): Resolution {
    return path ? { status: "resolved", path } : { status: "missing" };
  }

  private pick(fromPath: string, candidates: string[]): Resolution {
    if (candidates.length === 0) return { status: "missing" };
    if (candidates.length === 1) return { status: "resolved", path: candidates[0] as string };
    const sameFolder = candidates.filter((path) => posix.dirname(path) === posix.dirname(fromPath));
    if (sameFolder.length === 1) return { status: "resolved", path: sameFolder[0] as string };
    return { status: "ambiguous", candidates: [...candidates].sort() };
  }
}
