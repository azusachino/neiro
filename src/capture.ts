import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { stringify } from "yaml";
import { formatDate } from "./dateformat.ts";
import { splitFrontmatter, stringList, yamlScalar } from "./frontmatter.ts";
import { type History, historyChain } from "./history.ts";
import type { CaptureSettings } from "./settings.ts";
import { lowercaseTitle } from "./title.ts";

export interface CaptureInput {
  /** The note body. */
  text: string;
  /** Defaults to the first line of `text`. */
  title?: string;
  tags?: string[];
  source?: string;
  /** Other frontmatter to keep, written after the vault's declared properties. Declared keys are always filled by capture. */
  properties?: Record<string, unknown>;
  now?: Date;
}

export interface CaptureOptions {
  /** Build the note and report where it would go, without writing or running Git. */
  dryRun?: boolean;
  /** Commit the new note, and only it. */
  commit?: boolean;
  /** Pull with rebase before writing and push after committing. Implies `commit`. */
  push?: boolean;
  /** Commit author, as `Name <email>`. */
  author?: string;
}

export interface CaptureResult {
  path: string;
  content: string;
  written: boolean;
  committed: boolean;
  pushed: boolean;
}

const TITLE_LIMIT = 80;
const SLUG_LIMIT = 60;
const FILENAME_LIMIT = 120;
// Characters Obsidian refuses in a file name, or that break a wikilink to it.
const UNSAFE_FILENAME = /[*"\\/<>:|?#^[\]\p{Cc}]/gu;

export class CaptureError extends Error {}

/** Canonical kebab-case spelling: trimmed, lowercase, one hyphen between words, `/` kept between nested levels. */
export function canonicalTag(tag: string): string {
  return tag
    .trim()
    .replace(/^#/, "")
    .toLowerCase()
    .split("/")
    .map((part) => part.replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, ""))
    .join("/");
}

function validTags(tags: string[], settings: CaptureSettings): string[] {
  const spelled = tags.map((tag) => (settings.tagStyle === "kebab" ? canonicalTag(tag) : tag.trim().replace(/^#/, "")));
  const unique = [...new Set(spelled.filter((tag) => tag !== ""))];
  if (settings.requireTags && unique.length === 0) throw new CaptureError("this vault requires at least one tag");
  const shape =
    settings.tagStyle === "kebab"
      ? /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*(?:\/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*)*$/u
      : // Obsidian allows any character in a tag except whitespace and punctuation such as # , . : ; ! ? and brackets;
        // letters, digits, _, -, /, and emoji are all fine.
        /^[^\s#,.:;!?'"`()[\]{}<>|@$%^&*=+~\\]+$/u;
  const rejected = new Set(settings.rejectTags.map((tag) => tag.toLowerCase()));
  for (const tag of unique) {
    // Obsidian requires a tag to contain at least one character that is not a digit.
    if (!shape.test(tag) || /^[\d/]+$/.test(tag)) throw new CaptureError(`"${tag}" is not a valid tag`);
    if (rejected.has(tag.toLowerCase())) throw new CaptureError(`this vault does not allow the tag "${tag}"`);
  }
  return unique;
}

function titleFrom(input: CaptureInput, settings: CaptureSettings): string {
  const explicit = input.title?.trim();
  const firstLine = input.text
    .split("\n")
    // A heading, quote, or list marker is Markdown syntax, not part of the title.
    .map((line) => line.replace(/^\s*(?:#+|>|[-*+]|\d+[.)])\s+/, "").trim())
    .find((line) => line !== "");
  const raw = (explicit || firstLine || "").replace(/\s+/g, " ");
  if (raw === "") throw new CaptureError("a capture needs text or a title");
  const styled = settings.titleStyle === "lowercase" ? lowercaseTitle(raw, new Set(settings.titleAllow)) : raw;
  return styled.length > TITLE_LIMIT ? `${styled.slice(0, TITLE_LIMIT).trimEnd()}…` : styled;
}

const pad = (value: number) => String(value).padStart(2, "0");

function fallbackStem(now: Date): string {
  return `capture-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** The file name stem for a title: the title itself as Obsidian names files, or an ASCII kebab-case slug. */
export function fileStem(title: string, filename: CaptureSettings["filename"], now: Date): string {
  if (filename === "title") {
    const stem = title
      .replace(UNSAFE_FILENAME, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/, "")
      .slice(0, FILENAME_LIMIT);
    return stem === "" ? fallbackStem(now) : stem;
  }
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_LIMIT)
    .replace(/-+$/, "");
  return slug.length >= 3 ? slug : fallbackStem(now);
}

export function renderCapture(input: CaptureInput, settings: CaptureSettings): { title: string; content: string } {
  const now = input.now ?? new Date();
  const title = titleFrom(input, settings);
  const tags = validTags(input.tags ?? [], settings);
  const source = input.source?.trim();

  const lines: string[] = [];
  for (const key of settings.properties) {
    if (key === "title") lines.push(`title: ${yamlScalar(title)}`);
    else if (key === "created" || key === "modified")
      lines.push(`${key}: ${yamlScalar(formatDate(now, settings.timestampFormat))}`);
    else if (key === "tags") {
      if (tags.length > 0) lines.push("tags:", ...tags.map((tag) => `  - ${yamlScalar(tag)}`));
    } else if (key === "source") {
      if (source) lines.push(`source: ${yamlScalar(source)}`);
    } else if (settings.values[key] !== undefined) lines.push(`${key}: ${yamlScalar(settings.values[key] as string)}`);
  }
  const filled = new Set([...settings.properties, "title", "tags", "source"]);
  for (const [key, value] of Object.entries(input.properties ?? {})) {
    if (filled.has(key) || value === undefined) continue;
    // An empty property is kept as Obsidian writes it, `key:`, such as a template's blank to fill in later.
    lines.push(value === null ? `${key}:` : stringify({ [key]: value }, { lineWidth: 0 }).trimEnd());
  }
  const text = input.text.trim();
  const block = lines.length > 0 ? `---\n${lines.join("\n")}\n---\n` : "";
  const content = text === "" ? block : `${block}${block ? "\n" : ""}${text}\n`;

  const { data } = splitFrontmatter(content);
  const wroteTitle = settings.properties.includes("title");
  if ((wroteTitle && data.title !== title) || stringList(data.tags).join("\n") !== tags.join("\n")) {
    throw new CaptureError("rendered frontmatter did not round-trip");
  }
  return { title, content };
}

function freePath(root: string, folder: string, stem: string, filename: CaptureSettings["filename"]): string {
  const separator = filename === "title" ? " " : "-";
  for (let n = 1; ; n++) {
    const path = posix.join(folder, `${n === 1 ? stem : `${stem}${separator}${n}`}.md`);
    if (!existsSync(join(root, path))) return path;
  }
}

/** Create one new note in the capture folder. It never edits an existing file, so it cannot conflict with the owner's work. */
export async function capture(
  root: string,
  input: CaptureInput,
  settings: CaptureSettings,
  options: CaptureOptions = {},
  /** The vault's history, asked for only when committing, so a vault without one fails before anything is written. */
  history: () => History = () => historyChain(root).get(),
): Promise<CaptureResult> {
  const now = input.now ?? new Date();
  const { title, content } = renderCapture({ ...input, now }, settings);
  const stem = fileStem(title, settings.filename, now);
  const commit = options.commit || options.push || false;

  if (options.dryRun) {
    return {
      path: freePath(root, settings.folder, stem, settings.filename),
      content,
      written: false,
      committed: false,
      pushed: false,
    };
  }
  const store = commit ? history() : undefined;
  // Take others' captures first, so the free file name is free on the remote too.
  if (options.push) store?.sync();

  const path = freePath(root, settings.folder, stem, settings.filename);
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content, { flag: "wx" });

  store?.commit([path], `chore: capture ${path}`, options.author);
  if (options.push) store?.sync();
  return { path, content, written: true, committed: commit, pushed: options.push ?? false };
}

/**
 * Capture input from a whole Markdown document, such as a draft file. Its `title`, `tags`, and `source` properties
 * become capture inputs and its other properties are kept. Without a `title` property, the title is the first
 * heading, then the file name. The body is unchanged. This parses text only; reading files is the caller's choice.
 */
export function captureInputFromMarkdown(raw: string, fileName?: string): CaptureInput {
  const { data, body } = splitFrontmatter(raw);
  const { title, tags, source, ...properties } = data;
  const firstLine = body.split("\n").find((line) => line.trim() !== "");
  const heading = firstLine?.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)?.[1];
  const named = fileName ? posix.basename(fileName.replaceAll("\\", "/")).replace(/\.md$/i, "") : undefined;
  return {
    text: body,
    title: (typeof title === "string" && title.trim()) || heading || named,
    tags: stringList(tags),
    source: typeof source === "string" ? source : undefined,
    properties,
  };
}
