import { posix } from "node:path";

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
const FENCE = /^\s*(```|~~~)/;
const INLINE_CODE = /`[^`\n]*`/g;

/** Every wikilink and local Markdown link in a Markdown body, skipping fenced and inline code. */
export function extractLinks(body: string): WikiLink[] {
  const links: WikiLink[] = [];
  let fence: string | null = null;
  for (const line of body.split("\n")) {
    const opener = FENCE.exec(line)?.[1];
    if (opener) {
      if (fence === null) fence = opener;
      else if (opener === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const text = line.replace(INLINE_CODE, "");
    links.push(...wikilinks(text), ...markdownLinks(text.replace(LINK, "")));
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

  /** Resolve a link target the way Obsidian does: relative, vault-root path, path suffix, then unique stem. */
  resolve(fromPath: string, target: string): Resolution {
    if (/\.[a-z0-9]+$/i.test(target) && !/\.md$/i.test(target)) return { status: "asset" };
    const wanted = target.replace(/\.md$/i, "").toLowerCase();

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
