/**
 * The guards every targeted write shares: a unified diff for `dryRun`, a content-hash check for `ifHash`, and a change
 * confined to the target range, written whole through a rename. Nothing here deletes a file.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { createTwoFilesPatch } from "diff";
import { NeiroError } from "./errors.ts";

const BOM = "\uFEFF";

/** Raised when a write would overwrite a change made since the caller read the note. */
export class WriteConflictError extends NeiroError {}

export interface WriteOptions {
  /** Report the diff without writing. */
  dryRun?: boolean;
  /** Write only when the note's current hash, as `get` returned it, still matches; like HTTP's `If-Match`. */
  ifHash?: string;
}

export interface WriteResult {
  path: string;
  /** A unified diff from the note as it was to the note as written, or would be. */
  diff: string;
  written: boolean;
  created: boolean;
  /** The hash of the new content, for a following `ifHash`. */
  hash: string;
}

/** SHA-256 of a note's text as `get` reads it: decoded as UTF-8, a leading byte order mark dropped. */
export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Replace `text[start, end)` with `replacement`; every other character is unchanged. */
export function splice(text: string, start: number, end: number, replacement: string): string {
  if (start < 0 || end < start || end > text.length) throw new RangeError(`cannot splice ${start}:${end}`);
  return text.slice(0, start) + replacement + text.slice(end);
}

/**
 * Change one note. `next` turns the current text (undefined when the note does not exist) into the new text; the
 * write is refused when `ifHash` is stale.
 */
export async function writeNote(
  root: string,
  path: string,
  next: (current: string | undefined) => string,
  options: WriteOptions,
): Promise<WriteResult> {
  const file = join(root, path);
  const bytes = existsSync(file) ? readFileSync(file) : undefined;
  // TextDecoder drops a leading byte order mark, as the scan does; it is written back so it stays untouched.
  const current = bytes === undefined ? undefined : new TextDecoder().decode(bytes);
  const bom = bytes !== undefined && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (options.ifHash !== undefined && (current === undefined || contentHash(current) !== options.ifHash)) {
    const now = current === undefined ? "the note does not exist" : `its hash is now ${contentHash(current)}`;
    throw new WriteConflictError(`${path} changed since it was read: ${now}`);
  }
  const content = next(current);
  const patch = createTwoFilesPatch(`a/${path}`, `b/${path}`, current ?? "", content, "", "", { context: 3 });
  // Drop the package's `====` separator so the patch reads as `git diff` prints one.
  const diff = patch.replace(/^=+\n/, "");
  const result = { path, diff, created: current === undefined, hash: contentHash(content) };
  if (options.dryRun || content === current) return { ...result, written: false };

  mkdirSync(dirname(file), { recursive: true });
  replaceFile(file, bom ? BOM + content : content);
  return { ...result, written: true };
}

/**
 * Write through a temporary file in the same folder, then rename it over the target, so a crash or a reader never
 * sees half a note. The target keeps its mode, and a symbolic link keeps pointing where it did.
 */
function replaceFile(file: string, content: string): void {
  const target = existsSync(file) ? realpathSync(file) : file;
  // A dot name keeps the scan, and Obsidian, from reading the file while it is written.
  const temp = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(temp, content, { flag: "wx" });
    if (existsSync(target)) chmodSync(temp, statSync(target).mode & 0o7777);
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}
