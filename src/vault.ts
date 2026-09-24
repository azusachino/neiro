import { existsSync, readFileSync, statSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import {
  type CaptureConventions,
  type CaptureInput,
  type CaptureOptions,
  type CaptureResult,
  capture,
} from "./capture.ts";
import { type Frontmatter, splitFrontmatter, stringList } from "./frontmatter.ts";
import { DEFAULT_JOURNAL_LAYOUT, type JournalLayout, journalPath, type Period } from "./journal.ts";
import { extractLinks, LinkIndex, type Resolution } from "./links.ts";
import { rank, type SearchHit } from "./search.ts";

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
  modified?: string;
}

export interface NoteContent extends NoteSummary {
  frontmatter: Frontmatter;
  body: string;
  /** SHA-256 of the file's bytes, for detecting a concurrent change. */
  hash: string;
  truncated: boolean;
}

export interface Filter {
  type?: string;
  tag?: string;
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
  index?: NavEntry & { headings: string[] };
  folders: (NavEntry & { notes: number })[];
  notes: NavEntry[];
}

/** Settings a vault declares in its own `neiro.toml`; options passed in code take precedence. */
export interface VaultOptions {
  journal?: JournalLayout;
  /** Title words a capture keeps as written, such as `API` or `iPhone`. */
  titleAllow?: string[];
  /** Folder prefixes never scanned. Paths from the vault's `.gitmodules` are always excluded. */
  exclude?: string[];
}

export class NotFoundError extends Error {}

export class Vault {
  readonly root: string;
  private readonly journal: JournalLayout;
  private readonly conventions: CaptureConventions;
  private readonly exclude: string[];
  private cache?: { notes: Note[]; index: LinkIndex };

  constructor(root: string, options: VaultOptions = {}) {
    this.root = resolve(root);
    if (!existsSync(this.root) || !statSync(this.root).isDirectory())
      throw new NotFoundError(`no vault at ${this.root}`);
    const config = readConfig(this.root);
    this.journal = options.journal ?? { ...DEFAULT_JOURNAL_LAYOUT, ...config.journal };
    const allow = options.titleAllow ?? config.titleAllow;
    this.conventions = { titleAllow: allow ? new Set(allow) : null };
    this.exclude = ["node_modules", ...submodulePaths(this.root), ...(options.exclude ?? [])].map(folderPrefix);
  }

  /** Forget the scanned notes, e.g. after a `git pull`. */
  reload(): void {
    this.cache = undefined;
  }

  async notes(): Promise<Note[]> {
    return (await this.load()).notes;
  }

  async get(ref: string, options: { maxChars?: number } = {}): Promise<NoteContent> {
    const note = await this.find(ref);
    const max = options.maxChars;
    const truncated = max !== undefined && note.body.length > max;
    return {
      ...summarize(note),
      frontmatter: note.frontmatter,
      body: truncated ? note.body.slice(0, max) : note.body,
      hash: new Bun.CryptoHasher("sha256").update(note.raw).digest("hex"),
      truncated,
    };
  }

  async list(filter: Filter = {}): Promise<NoteSummary[]> {
    return (await this.filtered(filter)).map(summarize);
  }

  async search(query: string, filter: Filter & { limit?: number } = {}): Promise<SearchHit[]> {
    return rank(await this.filtered(filter), query, filter.limit ?? 10);
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
    const direct: NavEntry[] = [];
    for (const note of notes) {
      const rest = note.path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) {
        if (note !== indexNote) direct.push({ path: note.path, title: note.title });
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
              path: indexNote.path,
              title: indexNote.title,
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

  /** The journal note for the week or month containing `date`, or `null` with the path it would have. */
  async journalFor(period: Period, date: Date = new Date()): Promise<{ path: string; note: NoteContent | null }> {
    const path = journalPath(period, date, this.journal);
    const exists = (await this.notes()).some((note) => note.path === path);
    return { path, note: exists ? await this.get(path) : null };
  }

  async capture(input: CaptureInput, options: CaptureOptions = {}): Promise<CaptureResult> {
    const result = await capture(this.root, input, options, this.conventions);
    if (result.written) this.reload();
    return result;
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
    throw new NotFoundError(`no note matches "${ref}"`);
  }

  private async filtered(filter: Filter): Promise<Note[]> {
    const prefix = filter.under ? folderPrefix(filter.under) : "";
    return (await this.notes()).filter(
      (note) =>
        note.path.startsWith(prefix) &&
        (!filter.type || note.type === filter.type) &&
        (!filter.status || note.status === filter.status) &&
        (!filter.tag || note.tags.includes(filter.tag)),
    );
  }

  private async load(): Promise<{ notes: Note[]; index: LinkIndex }> {
    if (this.cache) return this.cache;
    const paths: string[] = [];
    for await (const path of new Bun.Glob("**/*.md").scan({ cwd: this.root, onlyFiles: true, dot: false })) {
      const posixPath = path.split("\\").join("/");
      if (!this.exclude.some((prefix) => posixPath.startsWith(prefix))) paths.push(posixPath);
    }
    paths.sort();
    const notes = await Promise.all(
      paths.map(async (path) => parseNote(path, await Bun.file(join(this.root, path)).text())),
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
    tags: stringList(data.tags),
    aliases: stringList(data.aliases),
    frontmatter: data,
    body,
    raw,
  };
}

function summarize(note: Note): NoteSummary {
  const modified = note.frontmatter.modified;
  return {
    path: note.path,
    title: note.title,
    ...(note.type ? { type: note.type } : {}),
    ...(note.status ? { status: note.status } : {}),
    tags: note.tags,
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

export const CONFIG_FILE = "neiro.toml";

/**
 * `neiro.toml` at the vault root, all keys optional:
 *
 *   [journal]
 *   week = "journal/{isoYear}/weekly/{isoYear}-w{ww}.md"
 *   month = "journal/{yyyy}/monthly/{yyyy}-{mm}.md"
 *
 *   [capture]
 *   title_allowlist = "path/to/allowlist.toml"   # every string in its arrays is allowed
 */
function readConfig(root: string): { journal: Partial<JournalLayout>; titleAllow?: string[] } {
  const file = join(root, CONFIG_FILE);
  if (!existsSync(file)) return { journal: {} };
  const config = Bun.TOML.parse(readFileSync(file, "utf8")) as {
    journal?: Partial<JournalLayout>;
    capture?: { title_allowlist?: string };
  };
  const journal = Object.fromEntries(
    Object.entries(config.journal ?? {}).filter(
      ([key, value]) => (key === "week" || key === "month") && typeof value === "string",
    ),
  ) as Partial<JournalLayout>;
  const allowFile = config.capture?.title_allowlist;
  if (typeof allowFile !== "string") return { journal };
  return { journal, titleAllow: stringsIn(Bun.TOML.parse(readFileSync(join(root, allowFile), "utf8"))) };
}

function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(stringsIn);
  return [];
}
