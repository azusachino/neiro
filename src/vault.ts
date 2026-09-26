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
import { TsuzuriError } from "./errors.ts";
import { type Frontmatter, frontmatterRange, splitFrontmatter, stringList } from "./frontmatter.ts";
import { fuzzyRank } from "./fuzzy.ts";
import { type GrepHit, type GrepOptions, grep } from "./grep.ts";
import { extractLinks, frontmatterLinks, LinkIndex, type Resolution, type WikiLink } from "./links.ts";
import { type AllowRule, Mask, type OperationName, PermissionError } from "./operations.ts";
import { rank } from "./search.ts";
import { findSection, headingsOf, SectionError, sectionContentEnd } from "./sections.ts";
import { resolveSettings, type TsuzuriConfig, UnsupportedError, type VaultSettings } from "./settings.ts";
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
  /** Settings in the shape of `tsuzuri.toml`, taking precedence over the vault's own `tsuzuri.toml`. */
  config?: TsuzuriConfig;
  /** Folder prefixes never scanned. Paths from the vault's `.gitmodules` are always excluded. */
  exclude?: string[];
  /**
   * For a long-running process: at most once per this many milliseconds, a read compares the notes' paths,
   * modification times, and sizes with the last scan and rescans when they changed. Unset, the scan is kept until
   * `reload()`; 0 checks on every read.
   */
  watch?: number;
  /**
   * The operations this `Vault` allows, by kind or name, optionally limited to folders (ADR 0018). Unset, everything
   * is allowed. A disallowed operation raises `PermissionError` before touching any file, and notes outside an
   * operation's folders are invisible to it.
   */
  allow?: AllowRule[];
}

/** The notes as last read, their link index, and the fingerprint `watch` compares. */
interface Scan {
  notes: Note[];
  index: LinkIndex;
  fingerprint: string;
  /** Every note's resolved links, built on the first link query and dropped with the scan. */
  graph?: LinkGraph;
}

interface LinkGraph {
  /** Each note's links in order, each with its resolution. */
  outgoing: Map<string, OutgoingLink[]>;
  /** For each note, the other notes whose links resolve to it. */
  incoming: Map<string, Set<string>>;
}

export class NotFoundError extends TsuzuriError {
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
export class LineRangeError extends TsuzuriError {}

export class Vault {
  readonly root: string;
  /** Resolved from code options, then `tsuzuri.toml`, then neutral defaults. */
  readonly settings: VaultSettings;
  private readonly exclude: string[];
  private cache?: Scan;
  /** The scan in flight, shared by every read that arrives while it runs. */
  private loading?: Promise<Scan>;
  /** Bumped by `reload`, so a scan that started before it does not become the cache. */
  private generation = 0;
  private readonly watch?: number;
  private checked = 0;
  private readonly mask: Mask;

  constructor(root: string, options: VaultOptions = {}) {
    this.root = resolve(root);
    if (!existsSync(this.root) || !statSync(this.root).isDirectory())
      throw new NotFoundError(`no vault at ${this.root}`);
    this.mask = new Mask(options.allow);
    this.settings = resolveSettings(this.root, options.config);
    this.exclude = ["node_modules", ...submodulePaths(this.root), ...(options.exclude ?? [])].map(folderPrefix);
    this.watch = options.watch;
  }

  /** Forget the scanned notes, e.g. after a `git pull`. */
  reload(): void {
    this.cache = undefined;
    this.loading = undefined;
    this.generation++;
  }

  async notes(): Promise<Note[]> {
    return this.reachable("notes");
  }

  async get(ref: string, options: GetOptions = {}): Promise<NoteContent> {
    const note = await this.resolve("get", ref);
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
    const notes = filtered(await this.reachable("list"), filter).map(summarize);
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
    return rank(filtered(await this.reachable("search"), filter), query, filter.limit ?? 10).map(
      ({ note, score, snippet }) => ({
        ...summarize(note),
        score,
        snippet,
      }),
    );
  }

  /** Lines matching a regular expression (or literal text with `fixed`), with ripgrep's smart case. */
  async grep(pattern: string, options: Filter & GrepOptions = {}): Promise<GrepHit[]> {
    return grep(filtered(await this.reachable("grep"), options), pattern, options);
  }

  /** Every tag in the filtered notes with its note count, so a writer can reuse a tag instead of inventing one. */
  async tags(filter: Filter = {}): Promise<TagCount[]> {
    return countTags(filtered(await this.reachable("tags"), filter));
  }

  /** A note's links, each resolved; under a mask, a link to a note the mask hides is left out. */
  async links(ref: string): Promise<OutgoingLink[]> {
    const note = await this.resolve("links", ref);
    const outgoing = (await this.graph()).outgoing.get(note.path) ?? [];
    return outgoing.flatMap((link) => {
      const resolution = this.visibleResolution("links", link.resolution);
      return resolution ? [{ ...link, resolution }] : [];
    });
  }

  async backlinks(ref: string): Promise<NoteSummary[]> {
    const target = await this.resolve("backlinks", ref);
    const sources = (await this.graph()).incoming.get(target.path) ?? new Set();
    return (await this.reachable("backlinks")).filter((note) => sources.has(note.path)).map(summarize);
  }

  /**
   * Notes no other note links to or embeds, narrowed by the filters; a note linking only to itself is an orphan.
   * Under a mask, only the links of notes the mask shows count.
   */
  async orphans(filter: Filter = {}): Promise<NoteSummary[]> {
    const { incoming } = await this.graph();
    const notes = await this.reachable("orphans");
    const shown = new Set(notes.map((note) => note.path));
    const linked = (note: Note) => [...(incoming.get(note.path) ?? [])].some((source) => shown.has(source));
    return filtered(notes, filter)
      .filter((note) => !linked(note))
      .map(summarize);
  }

  /** A note's ATX headings with their line numbers, counted as `get --lines` counts; fenced code is skipped. */
  async outline(ref: string): Promise<Heading[]> {
    const note = await this.resolve("outline", ref);
    return headingsOf(note.raw).map(({ level, text, line }) => ({ level, text, line }));
  }

  /**
   * Add text to the end of a note, or to the end of section `heading`. A missing heading is an error unless
   * `createHeading` is set, which adds it at the end of the note.
   */
  async append(ref: string, text: string, options: SectionWriteOptions = {}): Promise<WriteResult> {
    const note = await this.resolve("append", ref);
    return this.change(note.path, options, (current) => {
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
    const note = await this.resolve("putSection", ref);
    return this.change(note.path, options, (current) => {
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

  /**
   * Set one frontmatter key, adding it after the others when new. Comments, key order, quoting, and every other
   * line of the frontmatter are kept; a note without frontmatter gains a block.
   */
  async setProperty(ref: string, key: string, value: unknown, options: WriteOptions = {}): Promise<WriteResult> {
    const note = await this.resolve("setProperty", ref);
    return this.change(note.path, options, (current) => {
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
   * Replacing without the hash is refused.
   */
  async put(path: string, content: string, options: WriteOptions = {}): Promise<WriteResult> {
    const target = posix.normalize(path.replaceAll("\\", "/")).replace(/^\.\//, "");
    if (target.startsWith("/") || target.startsWith("../") || !target.endsWith(".md")) {
      throw new WriteConflictError(`put takes a .md path inside the vault, not "${path}"`);
    }
    this.mask.check("put", [target]);
    return this.recorded(
      writeNote(
        this.root,
        target,
        (current) => {
          if (current !== undefined && options.ifHash === undefined) {
            throw new WriteConflictError(`${target} exists; replacing it needs --if-hash with the hash get returned`);
          }
          return content;
        },
        options,
      ),
    );
  }

  /** Change an existing note through the shared write guards, then forget the scan so reads see the change. */
  private async change(path: string, options: WriteOptions, next: (current: string) => string): Promise<WriteResult> {
    return this.recorded(
      writeNote(
        this.root,
        path,
        (current) => {
          if (current === undefined) throw new NotFoundError(`${path} no longer exists`);
          return next(current);
        },
        options,
      ),
    );
  }

  /** Forget the scan after a write, so reads see the file. */
  private async recorded<T extends { written: boolean }>(write: Promise<T>): Promise<T> {
    const result = await write;
    if (result.written) this.reload();
    return result;
  }

  /** One frontmatter value of a note, as parsed; a note without the property raises `NotFoundError`. */
  async property(ref: string, key: string): Promise<unknown> {
    const note = await this.resolve("property", ref);
    if (!(key in note.frontmatter)) throw new NotFoundError(`${note.path} has no property "${key}"`);
    return note.frontmatter[key];
  }

  /**
   * Links that point at no note, or at more than one. Attachments are not checked. Under a mask, only the notes it
   * shows are checked, and an ambiguous link names only the candidates it shows.
   */
  async unresolved(): Promise<{ from: string; target: string; resolution: Resolution }[]> {
    const notes = await this.reachable("unresolved");
    const { outgoing } = await this.graph();
    return notes.flatMap((note) =>
      (outgoing.get(note.path) ?? []).flatMap(({ target, resolution }) => {
        if (resolution.status !== "missing" && resolution.status !== "ambiguous") return [];
        const shown = this.visibleResolution("unresolved", resolution) ?? resolution;
        return [{ from: note.path, target, resolution: shown }];
      }),
    );
  }

  /** A folder's own `index.md`, its subfolders, and its direct notes: the vault's navigation before any search. */
  async nav(folder = ""): Promise<NavView> {
    const prefix = folderPrefix(folder);
    const notes = (await this.reachable("nav")).filter((note) => note.path.startsWith(prefix));
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

  /**
   * Create a note from the vault's template for `type`, through `capture`: the template's placeholders are filled,
   * its properties and tags kept, and the note placed and styled by the vault's capture settings.
   */
  async create(
    type: string,
    title: string,
    options: CaptureOptions & { tags?: string[]; now?: Date } = {},
  ): Promise<CaptureResult> {
    this.mask.check("create");
    const settings = this.settings.templates;
    if (!settings) {
      throw new UnsupportedError("no template folder: set [templates] folder in tsuzuri.toml");
    }
    // Reading the template is part of creating from it, so the mask's read rules do not apply to it.
    const { notes } = await this.load();
    const paths = notes.map((note) => note.path);
    const path = templateFor(paths, settings.folder, type);
    if (!path) {
      const names = templateNames(paths, settings.folder);
      throw new NotFoundError(
        `no template for "${type}" in ${settings.folder}; there are: ${names.join(", ") || "none"}`,
      );
    }
    const now = options.now ?? new Date();
    const template = (notes.find((note) => note.path === path) as Note).raw;
    const input = captureInputFromMarkdown(renderTemplate(template, title, now, settings), path);
    const tags = [...(input.tags ?? []), ...(options.tags ?? [])];
    return this.captureAs("create", { ...input, title, tags, now }, options);
  }

  async capture(input: CaptureInput, options: CaptureOptions = {}): Promise<CaptureResult> {
    return this.captureAs("capture", input, options);
  }

  /** Capture under `op`: the note's path is planned first, and written only when the mask reaches it. */
  private async captureAs(op: OperationName, input: CaptureInput, options: CaptureOptions): Promise<CaptureResult> {
    this.mask.check(op);
    const planned = { ...input, now: input.now ?? new Date() };
    const plan = await capture(this.root, planned, this.settings.capture, { dryRun: true });
    this.mask.check(op, [plan.path]);
    return options.dryRun ? plan : this.recorded(capture(this.root, planned, this.settings.capture, options));
  }

  /**
   * Keep only the named fields of each result, in order: the result's own field, such as `score`, or else the note's
   * frontmatter key. A field neither has is `null`.
   */
  async select(items: { path: string }[], fields: string[]): Promise<Record<string, unknown>[]> {
    const byPath = new Map((await this.reachable("select")).map((note) => [note.path, note]));
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
    return this.resolve("find", ref);
  }

  /** Notes ranked by fuzzy match of the query over their path, title, and aliases, with fzf's scoring rules. */
  async suggest(query: string, options: Filter & { limit?: number; anyTerm?: boolean } = {}): Promise<Suggestion[]> {
    return suggestAmong(await this.reachable("suggest"), query, options);
  }

  /** The notes `op` may see: every note, or those in its folders. An operation the mask forbids is refused. */
  private async reachable(op: OperationName): Promise<Note[]> {
    this.mask.check(op);
    const { notes } = await this.load();
    return this.mask.scope(op).everywhere ? notes : notes.filter((note) => this.mask.reaches(op, note.path));
  }

  /** Resolve a reference among the notes `op` may see; a path outside them is refused by name, not reported missing. */
  private async resolve(op: OperationName, ref: string): Promise<Note> {
    const notes = await this.reachable(op);
    const wanted = ref.trim().replace(/^\.?\//, "");
    if (/[/\\]/.test(wanted) && !this.mask.reaches(op, wanted)) {
      throw new PermissionError(`this vault's mask does not allow ${op} on ${wanted}`);
    }
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
    let closest = suggestAmong(notes, wanted, { limit: 3 });
    if (closest.length === 0) closest = suggestAmong(notes, wanted, { limit: 3, anyTerm: true });
    throw new NotFoundError(
      `no note matches "${ref}"`,
      closest.map((hit) => hit.path),
    );
  }

  /** A link's resolution as `op` may see it: a hidden note is not shown, and an ambiguous link names what is. */
  private visibleResolution(op: OperationName, resolution: Resolution): Resolution | undefined {
    if (resolution.status === "resolved") return this.mask.reaches(op, resolution.path) ? resolution : undefined;
    if (resolution.status === "ambiguous") {
      return { status: "ambiguous", candidates: resolution.candidates.filter((path) => this.mask.reaches(op, path)) };
    }
    return resolution;
  }

  private async load(): Promise<Scan> {
    if (this.cache && this.watch !== undefined && Date.now() - this.checked >= this.watch) {
      this.checked = Date.now();
      if ((await this.fingerprint()) !== this.cache.fingerprint) this.cache = undefined;
    }
    if (this.cache) return this.cache;
    if (!this.loading) {
      const generation = this.generation;
      this.loading = this.scan().then(
        (scan) => {
          if (generation === this.generation) [this.cache, this.loading] = [scan, undefined];
          return scan;
        },
        (error) => {
          if (generation === this.generation) this.loading = undefined;
          throw error;
        },
      );
    }
    return this.loading;
  }

  /** The scan's link graph: every note's links resolved once, then reused until the next rescan. */
  private async graph(): Promise<LinkGraph> {
    const scan = await this.load();
    if (!scan.graph) {
      const outgoing = new Map<string, OutgoingLink[]>();
      const incoming = new Map<string, Set<string>>();
      for (const note of scan.notes) {
        const links = linksOf(note).map((link) => ({
          ...link,
          resolution: scan.index.resolve(note.path, link.target),
        }));
        outgoing.set(note.path, links);
        for (const { resolution } of links) {
          if (resolution.status !== "resolved" || resolution.path === note.path) continue;
          const sources = incoming.get(resolution.path) ?? new Set<string>();
          incoming.set(resolution.path, sources.add(note.path));
        }
      }
      scan.graph = { outgoing, incoming };
    }
    return scan.graph;
  }

  private async scan(): Promise<Scan> {
    const paths = await this.paths();
    // TextDecoder drops a leading byte order mark, so frontmatter after one is still found.
    const decoder = new TextDecoder();
    const notes = await Promise.all(
      paths.map(async (path) => parseNote(path, decoder.decode(await readFile(join(this.root, path))))),
    );
    const fingerprint = this.watch === undefined ? "" : await this.fingerprint(paths);
    this.checked = Date.now();
    return { notes, index: new LinkIndex(paths), fingerprint };
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

function filtered(notes: Note[], filter: Filter): Note[] {
  const prefix = filter.under ? folderPrefix(filter.under) : "";
  return notes.filter(
    (note) =>
      note.path.startsWith(prefix) &&
      (!filter.type || note.type === filter.type) &&
      (!filter.status || note.status === filter.status) &&
      [...(filter.tag ? [filter.tag] : []), ...(filter.tags ?? [])].every((tag) => tagMatches(note.tags, tag)) &&
      Object.entries(filter.where ?? {}).every(([key, value]) => propertyMatches(note.frontmatter[key], value)),
  );
}

function suggestAmong(
  notes: Note[],
  query: string,
  options: Filter & { limit?: number; anyTerm?: boolean },
): Suggestion[] {
  const candidates = filtered(notes, options).map((note) => ({
    item: note,
    texts: [note.path, note.title, ...note.aliases],
  }));
  const ranked = fuzzyRank(query, candidates, options.limit ?? 10, { anyTerm: options.anyTerm });
  return ranked.map(({ item, score, matched }) => ({ ...summarize(item), score, matched }));
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
