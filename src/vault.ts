import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import { type CaptureInput, type CaptureOptions, type CaptureResult, capture } from "./capture.ts";
import { type Frontmatter, splitFrontmatter, stringList } from "./frontmatter.ts";
import { fuzzyRank } from "./fuzzy.ts";
import { type GrepHit, type GrepOptions, grep } from "./grep.ts";
import { journalPath } from "./journal.ts";
import { extractLinks, LinkIndex, type Resolution } from "./links.ts";
import { rank } from "./search.ts";
import { type NeiroConfig, type Period, resolveSettings, type VaultSettings } from "./settings.ts";
import { countTags, noteTags, type TagCount, tagMatches } from "./tags.ts";

export interface Note {
  /** Vault-relative POSIX path, e.g. `note/tech/cognitive-load.md`. */
  path: string;
  title: string;
  type?: string;
  status?: string;
  tags: string[];
  aliases: string[];
  frontmatter: Frontmatter;
  body: string;
  raw: string;
}

export interface NoteSummary {
  path: string;
  title: string;
  type?: string;
  status?: string;
  tags: string[];
  created?: string;
  modified?: string;
}

/** A search result: the note's summary, its BM25 score, and the text around the first match. */
export interface SearchHit extends NoteSummary {
  score: number;
  snippet: string;
}

export interface NoteContent extends NoteSummary {
  frontmatter: Frontmatter;
  body: string;
  /** SHA-256 of the file's bytes, for detecting a concurrent change. */
  hash: string;
  truncated: boolean;
  /** With `lines` or `around`: the first and last line returned and the file's line count; `body` holds those lines. */
  start?: number;
  end?: number;
  total?: number;
}

/**
 * Options for `get`. Line numbers count from 1 at the top of the file, frontmatter included, as `rg -n`, editors,
 * and Git diffs count them.
 */
export interface GetOptions {
  maxChars?: number;
  /** An inclusive range; a missing `start` or `end` runs to the first or last line. */
  lines?: { start?: number; end?: number };
  /** One line and `context` lines either side, 5 by default. */
  around?: { line: number; context?: number };
}

export interface Filter {
  type?: string;
  /** Matches Obsidian's way: case-insensitive, and `area` also matches `area/sub`. */
  tag?: string;
  /** Every one of these tags must match, each as `tag` does. */
  tags?: string[];
  status?: string;
  /** A folder prefix such as `note/tech`. */
  under?: string;
}

export interface OutgoingLink {
  target: string;
  display?: string;
  embed: boolean;
  resolution: Resolution;
}

export interface NavEntry {
  path: string;
  title: string;
}

export interface NavView {
  folder: string;
  index?: NoteSummary & { headings: string[] };
  folders: (NavEntry & { notes: number })[];
  notes: NoteSummary[];
}

export interface VaultOptions {
  /** Settings in the shape of `neiro.toml`, taking precedence over the vault's own `neiro.toml` and Obsidian settings. */
  config?: NeiroConfig;
  /** Folder prefixes never scanned. Paths from the vault's `.gitmodules` are always excluded. */
  exclude?: string[];
}

export class NotFoundError extends Error {
  /** The closest notes by fuzzy match, when a reference resolved to none. */
  readonly suggestions: string[];

  constructor(message: string, suggestions: string[] = []) {
    super(suggestions.length > 0 ? `${message}; closest: ${suggestions.join(", ")}` : message);
    this.suggestions = suggestions;
  }
}

/** A fuzzy `suggest` result: the note's summary, its fzf-style score, and the path, title, or alias that matched. */
export interface Suggestion extends NoteSummary {
  score: number;
  matched: string;
}

/** A line range that does not fit the note; the message gives the note's line count. */
export class LineRangeError extends Error {}

export class Vault {
  readonly root: string;
  /** Resolved from code options, `neiro.toml`, the vault's Obsidian settings, then neutral defaults. */
  readonly settings: VaultSettings;
  private readonly exclude: string[];
  private cache?: { notes: Note[]; index: LinkIndex };

  constructor(root: string, options: VaultOptions = {}) {
    this.root = resolve(root);
    if (!existsSync(this.root) || !statSync(this.root).isDirectory())
      throw new NotFoundError(`no vault at ${this.root}`);
    this.settings = resolveSettings(this.root, options.config);
    this.exclude = ["node_modules", ...submodulePaths(this.root), ...(options.exclude ?? [])].map(folderPrefix);
  }

  /** Forget the scanned notes, e.g. after a `git pull`. */
  reload(): void {
    this.cache = undefined;
  }

  async notes(): Promise<Note[]> {
    return (await this.load()).notes;
  }

  async get(ref: string, options: GetOptions = {}): Promise<NoteContent> {
    const note = await this.find(ref);
    const range = lineRange(note, options);
    const text = range ? range.text : note.body;
    const max = options.maxChars;
    const truncated = max !== undefined && text.length > max;
    return {
      ...summarize(note),
      frontmatter: note.frontmatter,
      body: truncated ? text.slice(0, max) : text,
      hash: createHash("sha256").update(note.raw).digest("hex"),
      truncated,
      ...(range ? { start: range.start, end: range.end, total: range.total } : {}),
    };
  }

  async list(filter: Filter = {}): Promise<NoteSummary[]> {
    return (await this.filtered(filter)).map(summarize);
  }

  async search(query: string, filter: Filter & { limit?: number } = {}): Promise<SearchHit[]> {
    return rank(await this.filtered(filter), query, filter.limit ?? 10).map(({ note, score, snippet }) => ({
      ...summarize(note),
      score,
      snippet,
    }));
  }

  /** Lines matching a regular expression (or literal text with `fixed`), with ripgrep's smart case. */
  async grep(pattern: string, options: Filter & GrepOptions = {}): Promise<GrepHit[]> {
    return grep(await this.filtered(options), pattern, options);
  }

  /** Every tag in the filtered notes with its note count, so a writer can reuse a tag instead of inventing one. */
  async tags(filter: Filter = {}): Promise<TagCount[]> {
    return countTags(await this.filtered(filter));
  }

  async links(ref: string): Promise<OutgoingLink[]> {
    const note = await this.find(ref);
    const { index } = await this.load();
    return extractLinks(note.body).map((link) => ({ ...link, resolution: index.resolve(note.path, link.target) }));
  }

  async backlinks(ref: string): Promise<NoteSummary[]> {
    const target = await this.find(ref);
    const { notes, index } = await this.load();
    return notes
      .filter((note) => note.path !== target.path)
      .filter((note) =>
        extractLinks(note.body).some((link) => {
          const resolution = index.resolve(note.path, link.target);
          return resolution.status === "resolved" && resolution.path === target.path;
        }),
      )
      .map(summarize);
  }

  /** Links that point at no note, or at more than one. Attachments are not checked. */
  async unresolved(): Promise<{ from: string; target: string; resolution: Resolution }[]> {
    const { notes, index } = await this.load();
    return notes.flatMap((note) =>
      extractLinks(note.body)
        .map((link) => ({ from: note.path, target: link.target, resolution: index.resolve(note.path, link.target) }))
        .filter(({ resolution }) => resolution.status === "missing" || resolution.status === "ambiguous"),
    );
  }

  /** A folder's own `index.md`, its subfolders, and its direct notes: the vault's navigation before any search. */
  async nav(folder = ""): Promise<NavView> {
    const prefix = folderPrefix(folder);
    const notes = (await this.notes()).filter((note) => note.path.startsWith(prefix));
    const indexNote = notes.find((note) => note.path === `${prefix}index.md`);
    const folders = new Map<string, number>();
    const direct: NoteSummary[] = [];
    for (const note of notes) {
      const rest = note.path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) {
        if (note !== indexNote) direct.push(summarize(note));
      } else {
        const child = `${prefix}${rest.slice(0, slash)}`;
        folders.set(child, (folders.get(child) ?? 0) + 1);
      }
    }
    const titled = new Map(notes.map((note) => [note.path, note.title]));
    return {
      folder: prefix.replace(/\/$/, ""),
      ...(indexNote
        ? {
            index: {
              ...summarize(indexNote),
              headings: [...indexNote.body.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((match) => match[1] as string),
            },
          }
        : {}),
      folders: [...folders.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, count]) => ({
          path,
          title: titled.get(`${path}/index.md`) ?? posix.basename(path),
          notes: count,
        })),
      notes: direct.sort((a, b) => a.path.localeCompare(b.path)),
    };
  }

  /** The periodic note for the day, week, month, quarter, or year containing `date`, or `null` with the path it would have. */
  async journalFor(period: Period, date: Date = new Date()): Promise<{ path: string; note: NoteContent | null }> {
    const path = journalPath(period, date, this.settings.journal[period]);
    const exists = (await this.notes()).some((note) => note.path === path);
    return { path, note: exists ? await this.get(path) : null };
  }

  async capture(input: CaptureInput, options: CaptureOptions = {}): Promise<CaptureResult> {
    const result = await capture(this.root, input, this.settings.capture, options);
    if (result.written) this.reload();
    return result;
  }

  /**
   * Keep only the named fields of each result, in order: the result's own field, such as `score`, or else the note's
   * frontmatter key. A field neither has is `null`.
   */
  async select(items: { path: string }[], fields: string[]): Promise<Record<string, unknown>[]> {
    const byPath = new Map((await this.notes()).map((note) => [note.path, note]));
    return items.map((item) =>
      Object.fromEntries(
        fields.map((field) => [
          field,
          (field in item ? (item as Record<string, unknown>)[field] : byPath.get(item.path)?.frontmatter[field]) ??
            null,
        ]),
      ),
    );
  }

  /** Resolve a reference: a vault path (with or without `.md`), a unique filename stem, title, or alias. */
  async find(ref: string): Promise<Note> {
    const notes = await this.notes();
    const wanted = ref.trim().replace(/^\.?\//, "");
    const lower = wanted.toLowerCase();
    const byPath = notes.find((note) => note.path.toLowerCase() === lower || note.path.toLowerCase() === `${lower}.md`);
    if (byPath) return byPath;
    const matchers: ((note: Note) => boolean)[] = [
      (note) => posix.basename(note.path, ".md").toLowerCase() === lower,
      (note) => note.title.toLowerCase() === lower,
      (note) => note.aliases.some((alias) => alias.toLowerCase() === lower),
    ];
    for (const matches of matchers) {
      const found = notes.filter(matches);
      if (found.length === 1) return found[0] as Note;
      if (found.length > 1) {
        throw new NotFoundError(`"${ref}" matches ${found.length} notes: ${found.map((note) => note.path).join(", ")}`);
      }
    }
    // A typo can break one word's subsequence; then any word that still matches is enough to suggest.
    let closest = await this.suggest(wanted, { limit: 3 });
    if (closest.length === 0) closest = await this.suggest(wanted, { limit: 3, anyTerm: true });
    throw new NotFoundError(
      `no note matches "${ref}"`,
      closest.map((hit) => hit.path),
    );
  }

  /** Notes ranked by fuzzy match of the query over their path, title, and aliases, with fzf's scoring rules. */
  async suggest(query: string, options: Filter & { limit?: number; anyTerm?: boolean } = {}): Promise<Suggestion[]> {
    const candidates = (await this.filtered(options)).map((note) => ({
      item: note,
      texts: [note.path, note.title, ...note.aliases],
    }));
    const ranked = fuzzyRank(query, candidates, options.limit ?? 10, { anyTerm: options.anyTerm });
    return ranked.map(({ item, score, matched }) => ({
      ...summarize(item),
      score,
      matched,
    }));
  }

  private async filtered(filter: Filter): Promise<Note[]> {
    const prefix = filter.under ? folderPrefix(filter.under) : "";
    return (await this.notes()).filter(
      (note) =>
        note.path.startsWith(prefix) &&
        (!filter.type || note.type === filter.type) &&
        (!filter.status || note.status === filter.status) &&
        [...(filter.tag ? [filter.tag] : []), ...(filter.tags ?? [])].every((tag) => tagMatches(note.tags, tag)),
    );
  }

  private async load(): Promise<{ notes: Note[]; index: LinkIndex }> {
    if (this.cache) return this.cache;
    const paths = (await markdownFiles(this.root)).filter(
      (path) => !this.exclude.some((prefix) => path.startsWith(prefix)),
    );
    paths.sort();
    // TextDecoder drops a leading byte order mark, so frontmatter after one is still found.
    const decoder = new TextDecoder();
    const notes = await Promise.all(
      paths.map(async (path) => parseNote(path, decoder.decode(await readFile(join(this.root, path))))),
    );
    this.cache = { notes, index: new LinkIndex(paths) };
    return this.cache;
  }
}

function parseNote(path: string, raw: string): Note {
  const { data, body } = splitFrontmatter(raw);
  const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value : undefined);
  return {
    path,
    title: text(data.title) ?? posix.basename(path, ".md"),
    type: text(data.type),
    status: text(data.status),
    tags: noteTags(data.tags),
    aliases: stringList(data.aliases),
    frontmatter: data,
    body,
    raw,
  };
}

/** The requested lines of the file; a range may run past either end, but its anchor line must exist. */
function lineRange(note: Note, options: GetOptions) {
  if (!options.lines && !options.around) return undefined;
  if (options.lines && options.around) throw new LineRangeError("give lines or around, not both");
  const lines = note.raw.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const total = lines.length;
  let start: number;
  let end: number;
  if (options.around) {
    const { line, context = 5 } = options.around;
    if (!Number.isInteger(line) || line < 1 || line > total || !Number.isInteger(context) || context < 0) {
      throw new LineRangeError(`${note.path} has ${total} lines; cannot read around line ${line}`);
    }
    start = line - context;
    end = line + context;
  } else {
    start = options.lines?.start ?? 1;
    end = options.lines?.end ?? total;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || start > total || end < start) {
      throw new LineRangeError(`${note.path} has ${total} lines; cannot read lines ${start}:${end}`);
    }
  }
  start = Math.max(1, start);
  end = Math.min(total, end);
  return { start, end, total, text: lines.slice(start - 1, end).join("\n") };
}

function summarize(note: Note): NoteSummary {
  const { created, modified } = note.frontmatter;
  return {
    path: note.path,
    title: note.title,
    ...(note.type ? { type: note.type } : {}),
    ...(note.status ? { status: note.status } : {}),
    tags: note.tags,
    ...(created !== undefined ? { created: String(created) } : {}),
    ...(modified !== undefined ? { modified: String(modified) } : {}),
  };
}

function folderPrefix(folder: string): string {
  const trimmed = folder
    .trim()
    .replace(/^\.?\/+/, "")
    .replace(/\/+$/, "");
  return trimmed === "" ? "" : `${trimmed}/`;
}

function submodulePaths(root: string): string[] {
  const file = join(root, ".gitmodules");
  if (!existsSync(file)) return [];
  return [...readFileSync(file, "utf8").matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)].map((match) => match[1] as string);
}

/**
 * Vault-relative POSIX paths of every `.md` file outside dot folders, unsorted; symbolic links are skipped. This walk
 * measured two to three times faster than Bun's own glob scanner, so listing needs no fallback chain.
 */
async function markdownFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(prefix ? join(root, prefix) : root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      if (entry.name.startsWith(".")) return [];
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return markdownFiles(root, path);
      return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
    }),
  );
  return nested.flat();
}
