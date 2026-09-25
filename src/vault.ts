import { existsSync, readFileSync, statSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import ignore from "ignore";
import { parseDocument, stringify } from "yaml";
import {
  type CaptureInput,
  type CaptureOptions,
  type CaptureResult,
  capture,
  captureInputFromMarkdown,
} from "./capture.ts";
import type { Chain } from "./chain.ts";
import { type Frontmatter, frontmatterRange, splitFrontmatter, stringList } from "./frontmatter.ts";
import { fuzzyRank } from "./fuzzy.ts";
import { type GrepHit, type GrepOptions, grep } from "./grep.ts";
import { type History, historyChain } from "./history.ts";
import { journalPath } from "./journal.ts";
import { extractLinks, frontmatterLinks, LinkIndex, type Resolution, type WikiLink } from "./links.ts";
import { rank } from "./search.ts";
import { findSection, headingsOf, SectionError, sectionContentEnd } from "./sections.ts";
import { type NeiroConfig, type Period, resolveSettings, UnsupportedError, type VaultSettings } from "./settings.ts";
import { countTags, noteTags, type TagCount, tagMatches } from "./tags.ts";
import { renderTemplate, templateFor, templateNames } from "./templates.ts";
import { contentHash, splice, WriteConflictError, type WriteOptions, type WriteResult, writeNote } from "./write.ts";

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
  /**
   * Frontmatter conditions that must all hold: a value compares as text, a list property matches when any item does,
   * and `null` means the property only has to be present.
   */
  where?: Record<string, string | null>;
}

export const SORT_KEYS = ["modified", "created", "title", "path"] as const;

export interface ListOptions {
  /** Dates sort as written, so ISO dates sort in time order. */
  sort?: (typeof SORT_KEYS)[number];
  desc?: boolean;
  limit?: number;
}

export interface OutgoingLink {
  target: string;
  display?: string;
  embed: boolean;
  resolution: Resolution;
}

export interface Heading {
  level: number;
  text: string;
  /** Counted from the top of the file, frontmatter included. */
  line: number;
}

export interface SectionWriteOptions extends WriteOptions {
  /** A section to write in, by heading text; without it, `append` writes at the end of the note. */
  heading?: string;
  /** Add a missing heading at the end of the note instead of refusing. */
  createHeading?: boolean;
  /** The level of a created heading; 2 by default. */
  level?: number;
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
  /**
   * For a long-running process: at most once per this many milliseconds, a read compares the notes' paths,
   * modification times, and sizes with the last scan and rescans when they changed. Unset, the scan is kept until
   * `reload()` or `sync()`; 0 checks on every read.
   */
  watch?: number;
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
  private cache?: { notes: Note[]; index: LinkIndex; fingerprint: string };
  private readonly watch?: number;
  private checked = 0;
  private historyChain?: Chain<History>;

  constructor(root: string, options: VaultOptions = {}) {
    this.root = resolve(root);
    if (!existsSync(this.root) || !statSync(this.root).isDirectory())
      throw new NotFoundError(`no vault at ${this.root}`);
    this.settings = resolveSettings(this.root, options.config);
    this.exclude = ["node_modules", ...submodulePaths(this.root), ...(options.exclude ?? [])].map(folderPrefix);
    this.watch = options.watch;
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
      hash: contentHash(note.raw),
      truncated,
      ...(range ? { start: range.start, end: range.end, total: range.total } : {}),
    };
  }

  async list(filter: Filter & ListOptions = {}): Promise<NoteSummary[]> {
    const notes = (await this.filtered(filter)).map(summarize);
    if (filter.sort) {
      const key = filter.sort;
      const direction = filter.desc ? -1 : 1;
      notes.sort((a, b) => {
        const left = a[key];
        const right = b[key];
        // Notes without the value sort last in either direction, as a spreadsheet does.
        if (left === undefined || right === undefined) return left === right ? 0 : left === undefined ? 1 : -1;
        return direction * left.localeCompare(right) || a.path.localeCompare(b.path);
      });
    }
    return filter.limit === undefined ? notes : notes.slice(0, filter.limit);
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
    return linksOf(note).map((link) => ({ ...link, resolution: index.resolve(note.path, link.target) }));
  }

  async backlinks(ref: string): Promise<NoteSummary[]> {
    const target = await this.find(ref);
    const { notes, index } = await this.load();
    return notes
      .filter((note) => note.path !== target.path)
      .filter((note) =>
        linksOf(note).some((link) => {
          const resolution = index.resolve(note.path, link.target);
          return resolution.status === "resolved" && resolution.path === target.path;
        }),
      )
      .map(summarize);
  }

  /** Notes no other note links to or embeds, narrowed by the filters; a note linking only to itself is an orphan. */
  async orphans(filter: Filter = {}): Promise<NoteSummary[]> {
    const { notes, index } = await this.load();
    const linked = new Set<string>();
    for (const note of notes) {
      for (const link of linksOf(note)) {
        const resolution = index.resolve(note.path, link.target);
        if (resolution.status === "resolved" && resolution.path !== note.path) linked.add(resolution.path);
      }
    }
    return (await this.filtered(filter)).filter((note) => !linked.has(note.path)).map(summarize);
  }

  /** A note's ATX headings with their line numbers, counted as `get --lines` counts; fenced code is skipped. */
  async outline(ref: string): Promise<Heading[]> {
    const note = await this.find(ref);
    return headingsOf(note.raw).map(({ level, text, line }) => ({ level, text, line }));
  }

  /**
   * Add text to the end of a note, or to the end of section `heading`. A missing heading is an error unless
   * `createHeading` is set, which adds it at the end of the note.
   */
  async append(ref: string, text: string, options: SectionWriteOptions = {}): Promise<WriteResult> {
    const note = await this.find(ref);
    return this.change(note.path, `docs: append to ${note.path}`, options, (current) => {
      const addition = text.replace(/\s+$/, "");
      if (options.heading === undefined) return `${withNewline(current)}${addition}\n`;
      const section = findSection(current, options.heading);
      if (!section) return createSection(current, options, addition);
      // After the section's last character, on a line of its own; an empty section keeps its blank line below.
      const at = sectionContentEnd(current, section);
      const lead = current[at - 1] === "\n" ? "" : "\n";
      const tail = at === current.length || at === section.heading.bodyStart ? "\n" : "";
      return splice(current, at, at, `${lead}${addition}${tail}`);
    });
  }

  /** Replace section `heading`'s body, or add the section at the end of the note when it is missing. */
  async putSection(ref: string, heading: string, text: string, options: WriteOptions & { level?: number } = {}) {
    const note = await this.find(ref);
    return this.change(note.path, `docs: set section ${heading} of ${note.path}`, options, (current) => {
      const body = text.replace(/^\s+|\s+$/g, "");
      const section = findSection(current, heading);
      if (!section) return createSection(current, { ...options, heading, createHeading: true }, body);
      const old = current.slice(section.heading.bodyStart, section.end);
      const atEnd = section.end === current.length;
      const lead = /^\s*/.exec(old)?.[0] ?? "";
      const trail = /\s*$/.exec(old)?.[0] ?? "";
      const blank = old.trim() === "";
      const replacement = blank ? `\n${body}\n${atEnd ? "" : "\n"}` : `${lead}${body}${trail === "" ? "\n" : trail}`;
      return splice(current, section.heading.bodyStart, section.end, replacement);
    });
  }

  /** The periodic note for `date`'s day, week, month, quarter, or year, with `text` appended as `append` does. */
  async appendJournal(period: Period, text: string, options: SectionWriteOptions & { date?: Date } = {}) {
    const { path, note } = await this.journalFor(period, options.date);
    if (!note) throw new NotFoundError(`${path} is not written yet; the ${period} note must exist to append to it`);
    return this.append(path, text, options);
  }

  /**
   * Set one frontmatter key, adding it after the others when new. Comments, key order, quoting, and every other
   * line of the frontmatter are kept; a note without frontmatter gains a block.
   */
  async setProperty(ref: string, key: string, value: unknown, options: WriteOptions = {}): Promise<WriteResult> {
    const note = await this.find(ref);
    return this.change(note.path, `docs: set ${key} of ${note.path}`, options, (current) => {
      const range = frontmatterRange(current);
      if (!range) return `---\n${stringify({ [key]: value }, { lineWidth: 0 })}---\n${current}`;
      const doc = parseDocument(current.slice(range.start, range.end));
      if (doc.errors.length > 0) {
        throw new WriteConflictError(`${note.path} has frontmatter YAML cannot parse: ${doc.errors[0]?.message}`);
      }
      doc.set(key, value);
      const yaml = doc.toString({ flowCollectionPadding: false, lineWidth: 0 }).replace(/\n$/, "");
      // An empty block has no line break of its own before the closing fence.
      return splice(current, range.start, range.end, range.start === range.end ? `${yaml}\n` : yaml);
    });
  }

  /**
   * Write a whole note at a vault path: create it, or replace it only when `ifHash` matches its current content.
   * Replacing without the hash is refused. Restoring an old revision is a put of its content, a new revision.
   */
  async put(path: string, content: string, options: WriteOptions = {}): Promise<WriteResult> {
    const target = posix.normalize(path.replaceAll("\\", "/")).replace(/^\.\//, "");
    if (target.startsWith("/") || target.startsWith("../") || !target.endsWith(".md")) {
      throw new WriteConflictError(`put takes a .md path inside the vault, not "${path}"`);
    }
    const result = writeNote(
      this.root,
      target,
      (current) => {
        if (current !== undefined && options.ifHash === undefined) {
          throw new WriteConflictError(`${target} exists; replacing it needs --if-hash with the hash get returned`);
        }
        return content;
      },
      `docs: put ${target}`,
      options,
      () => this.history,
    );
    if (result.written) this.reload();
    return result;
  }

  /** Change an existing note through the shared write guards, then forget the scan so reads see the change. */
  private change(path: string, message: string, options: WriteOptions, next: (current: string) => string): WriteResult {
    const result = writeNote(
      this.root,
      path,
      (current) => {
        if (current === undefined) throw new NotFoundError(`${path} no longer exists`);
        return next(current);
      },
      message,
      options,
      () => this.history,
    );
    if (result.written) this.reload();
    return result;
  }

  /** One frontmatter value of a note, as parsed; a note without the property raises `NotFoundError`. */
  async property(ref: string, key: string): Promise<unknown> {
    const note = await this.find(ref);
    if (!(key in note.frontmatter)) throw new NotFoundError(`${note.path} has no property "${key}"`);
    return note.frontmatter[key];
  }

  /** Links that point at no note, or at more than one. Attachments are not checked. */
  async unresolved(): Promise<{ from: string; target: string; resolution: Resolution }[]> {
    const { notes, index } = await this.load();
    return notes.flatMap((note) =>
      linksOf(note)
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
              headings: headingsOf(indexNote.raw).map((heading) => heading.text),
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

  /**
   * Create a note from the vault's template for `type`, through `capture`: the template's placeholders are filled,
   * its properties and tags kept, and the note placed and styled by the vault's capture settings.
   */
  async create(
    type: string,
    title: string,
    options: CaptureOptions & { tags?: string[]; now?: Date } = {},
  ): Promise<CaptureResult> {
    const settings = this.settings.templates;
    if (!settings) {
      throw new UnsupportedError(
        "no template folder: set [templates] folder in neiro.toml, or Obsidian's Templates folder",
      );
    }
    const paths = (await this.notes()).map((note) => note.path);
    const path = templateFor(paths, settings.folder, type);
    if (!path) {
      const names = templateNames(paths, settings.folder);
      throw new NotFoundError(
        `no template for "${type}" in ${settings.folder}; there are: ${names.join(", ") || "none"}`,
      );
    }
    const now = options.now ?? new Date();
    const template = (await this.find(path)).raw;
    const input = captureInputFromMarkdown(renderTemplate(template, title, now, settings), path);
    return this.capture({ ...input, title, tags: [...(input.tags ?? []), ...(options.tags ?? [])], now }, options);
  }

  /** The vault's revisions: Git when the root is inside a work tree, otherwise this raises `UnsupportedError`. */
  get history(): History {
    this.historyChain ??= historyChain(this.root);
    return this.historyChain.get();
  }

  async capture(input: CaptureInput, options: CaptureOptions = {}): Promise<CaptureResult> {
    const result = await capture(this.root, input, this.settings.capture, options, () => this.history);
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
        [...(filter.tag ? [filter.tag] : []), ...(filter.tags ?? [])].every((tag) => tagMatches(note.tags, tag)) &&
        Object.entries(filter.where ?? {}).every(([key, value]) => propertyMatches(note.frontmatter[key], value)),
    );
  }

  /** Take others' revisions and publish this one's through `History`, then reload so reads see what arrived. */
  sync(): void {
    this.history.sync();
    this.reload();
  }

  private async load(): Promise<{ notes: Note[]; index: LinkIndex }> {
    if (this.cache && this.watch !== undefined && Date.now() - this.checked >= this.watch) {
      this.checked = Date.now();
      if ((await this.fingerprint()) !== this.cache.fingerprint) this.cache = undefined;
    }
    if (this.cache) return this.cache;
    const paths = await this.paths();
    // TextDecoder drops a leading byte order mark, so frontmatter after one is still found.
    const decoder = new TextDecoder();
    const notes = await Promise.all(
      paths.map(async (path) => parseNote(path, decoder.decode(await readFile(join(this.root, path))))),
    );
    const fingerprint = this.watch === undefined ? "" : await this.fingerprint(paths);
    this.checked = Date.now();
    this.cache = { notes, index: new LinkIndex(paths), fingerprint };
    return this.cache;
  }

  private async paths(): Promise<string[]> {
    const ignored = gitignore(this.root);
    const paths = (await markdownFiles(this.root)).filter(
      (path) => !this.exclude.some((prefix) => path.startsWith(prefix)) && !ignored(path),
    );
    return paths.sort();
  }

  /** Every note's path, modification time, and size: a change to any of them means the files changed. */
  private async fingerprint(paths?: string[]): Promise<string> {
    const current = paths ?? (await this.paths());
    const stats = await Promise.all(current.map((path) => stat(join(this.root, path))));
    return current.map((path, i) => `${path}\0${stats[i]?.mtimeMs}\0${stats[i]?.size}`).join("\n");
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

/** A frontmatter value against a `where` condition; `null` asks only that the property be present. */
function propertyMatches(actual: unknown, wanted: string | null): boolean {
  if (actual === undefined) return false;
  if (wanted === null) return true;
  if (Array.isArray(actual)) return actual.some((item) => propertyMatches(item, wanted));
  return actual !== null && typeof actual !== "object" && String(actual) === wanted;
}

function withNewline(text: string): string {
  return text === "" || text.endsWith("\n") ? text : `${text}\n`;
}

/** Add `## heading` and its body at the end of the note, or refuse when `createHeading` is not set. */
function createSection(current: string, options: SectionWriteOptions, body: string): string {
  if (!options.createHeading) {
    throw new SectionError(`no section "${options.heading}"; pass createHeading to add it at the end`);
  }
  const heading = `${"#".repeat(options.level ?? 2)} ${options.heading}`;
  const gap = current.trim() === "" ? "" : "\n";
  return `${withNewline(current)}${gap}${heading}\n\n${body}\n`;
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

/** The vault root's `.gitignore`, as ripgrep honors it; a vault without one ignores nothing. */
function gitignore(root: string): (path: string) => boolean {
  const file = join(root, ".gitignore");
  if (!existsSync(file)) return () => false;
  const rules = ignore().add(readFileSync(file, "utf8"));
  return (path) => rules.ignores(path);
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

/** A note's links as Obsidian counts them: wikilinks in its frontmatter values, then links in its body. */
function linksOf(note: Note): WikiLink[] {
  return [...frontmatterLinks(note.frontmatter), ...extractLinks(note.body)];
}
