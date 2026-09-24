import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { splitFrontmatter, yamlScalar } from "./frontmatter.ts";
import { normalizeTitle } from "./title.ts";

export interface CaptureInput {
  /** The note body. */
  text: string;
  /** Defaults to the first line of `text`. */
  title?: string;
  /** At least one subject tag. */
  tags: string[];
  source?: string;
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

/** Vault conventions a capture must satisfy. */
export interface CaptureConventions {
  /** Title words kept as written; `null` keeps only all-caps words such as `API`. */
  titleAllow: ReadonlySet<string> | null;
}

export const DEFAULT_CONVENTIONS: CaptureConventions = { titleAllow: null };

export interface CaptureResult {
  path: string;
  content: string;
  written: boolean;
  committed: boolean;
  pushed: boolean;
}

export const INBOX_DIR = "inbox";
const TITLE_LIMIT = 80;
const SLUG_LIMIT = 60;
// Workflow words belong in `status`, never in tags.
const WORKFLOW_WORDS = new Set(["inbox", "active", "paused", "maintained"]);

export class CaptureError extends Error {}

/** Canonical tag spelling: trimmed, lowercase, one hyphen between words. */
export function canonicalTag(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function validTags(tags: string[]): string[] {
  const canonical = [...new Set(tags.map(canonicalTag).filter((tag) => tag !== ""))];
  if (canonical.length === 0) throw new CaptureError("a capture needs at least one subject tag");
  for (const tag of canonical) {
    if (!/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(tag))
      throw new CaptureError(`tag "${tag}" has unsupported punctuation`);
    if (WORKFLOW_WORDS.has(tag)) throw new CaptureError(`"${tag}" is a workflow state, not a subject tag`);
  }
  return canonical;
}

function titleFrom(input: CaptureInput, conventions: CaptureConventions): string {
  const explicit = input.title?.trim();
  const firstLine = input.text
    .split("\n")
    // A heading, quote, or list marker is Markdown syntax, not part of the title.
    .map((line) => line.replace(/^\s*(?:#+|>|[-*+]|\d+[.)])\s+/, "").trim())
    .find((line) => line !== "");
  const title = normalizeTitle((explicit || firstLine || "").replace(/\s+/g, " "), conventions.titleAllow);
  if (title === "") throw new CaptureError("a capture needs text or a title");
  return title.length > TITLE_LIMIT ? `${title.slice(0, TITLE_LIMIT).trimEnd()}…` : title;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** `YYYY-MM-DD HH:MM` in local time, the vault's timestamp format. */
export function timestamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** An ASCII kebab-case filename stem; titles with no ASCII letters fall back to a timestamp. */
export function slugFor(title: string, now: Date): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_LIMIT)
    .replace(/-+$/, "");
  return slug.length >= 3
    ? slug
    : `capture-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export function renderCapture(
  input: CaptureInput,
  conventions: CaptureConventions = DEFAULT_CONVENTIONS,
): { title: string; content: string } {
  const now = input.now ?? new Date();
  const title = titleFrom(input, conventions);
  const tags = validTags(input.tags);
  const lines = [
    "---",
    `title: ${yamlScalar(title)}`,
    `created: ${timestamp(now)}`,
    `modified: ${timestamp(now)}`,
    "type: inbox",
    "status: inbox",
    "maturity: seed",
    "tags:",
    ...tags.map((tag) => `  - ${yamlScalar(tag)}`),
    ...(input.source ? [`source: ${yamlScalar(input.source.trim())}`] : []),
    "---",
    "",
    input.text.trim(),
    "",
  ];
  const content = lines.join("\n");
  const { data } = splitFrontmatter(content);
  if (data.title !== title || data.type !== "inbox") throw new CaptureError("rendered frontmatter did not round-trip");
  return { title, content };
}

function git(root: string, args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new CaptureError(`git ${args[0]} failed: ${result.stderr.toString().trim() || `exit ${result.exitCode}`}`);
  }
}

function freePath(root: string, slug: string): string {
  for (let n = 1; ; n++) {
    const path = `${INBOX_DIR}/${n === 1 ? slug : `${slug}-${n}`}.md`;
    if (!existsSync(join(root, path))) return path;
  }
}

/** Create one new inbox note. It never edits an existing file, so it cannot conflict with the owner's work. */
export async function capture(
  root: string,
  input: CaptureInput,
  options: CaptureOptions = {},
  conventions: CaptureConventions = DEFAULT_CONVENTIONS,
): Promise<CaptureResult> {
  const now = input.now ?? new Date();
  const { title, content } = renderCapture({ ...input, now }, conventions);
  const commit = options.commit || options.push || false;

  if (options.dryRun) {
    return { path: freePath(root, slugFor(title, now)), content, written: false, committed: false, pushed: false };
  }
  if (options.push) git(root, ["pull", "--rebase", "--quiet"]);

  const path = freePath(root, slugFor(title, now));
  mkdirSync(join(root, INBOX_DIR), { recursive: true });
  await Bun.write(join(root, path), content);

  if (commit) {
    git(root, ["add", "--", path]);
    git(root, [
      "commit",
      "--quiet",
      "-m",
      `chore: capture ${path}`,
      ...(options.author ? ["--author", options.author] : []),
      "--",
      path,
    ]);
  }
  if (options.push) git(root, ["push", "--quiet"]);
  return { path, content, written: true, committed: commit, pushed: options.push ?? false };
}
