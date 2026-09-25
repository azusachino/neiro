#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";
import pkg from "../package.json" with { type: "json" };
// The CLI uses only the public SDK surface, the same one library consumers import.
import {
  CaptureError,
  captureInputFromMarkdown,
  type Filter,
  formatGrep,
  type GrepHit,
  HistoryError,
  LineRangeError,
  NotFoundError,
  PERIODS,
  type Period,
  parseDate,
  propertyValue,
  SectionError,
  type SectionWriteOptions,
  SORT_KEYS,
  UnsupportedError,
  Vault,
  WriteConflictError,
  type WriteOptions,
  type WriteResult,
} from "./index.ts";

const USAGE = `neiro ${pkg.version}: read and capture into an Obsidian-compatible Markdown vault

usage: neiro <command> [options]

commands:
  get <note>                   print one note (path, filename, title, or alias)
  search <query...>            rank notes by relevance
  grep <pattern>               matching lines as path:line:text, like rg -n (smart case)
  tags                         every tag with its note count, parents of nested tags included
  find <query...>              fuzzy match over paths, titles, and aliases, ranked as fzf ranks
  list                         list notes matching the filters
  nav [folder]                 a folder's index, subfolders, and notes
  links <note>                 outgoing links and how each resolves
  backlinks <note>             notes that link to a note
  history <note>               revisions of a note, newest first (--limit, default 20)
  show <note> --rev <rev>      a note's content at a revision
  diff <note> [--rev r] [--to r]
                               a note's changes since --rev (default HEAD), or between two revisions
  orphans                      notes no other note links to or embeds
  outline <note>               a note's headings with their line numbers
  prop get <note> <key>        one frontmatter value
  unresolved                   links pointing at no note, or at several
  journal <period>             the day, week, month, quarter, or year note for a date
  capture [text...]            create a new note from text, --file, or stdin
  new <type> <title...>        create a note from the vault's template for type, placed as capture places it

writes (each takes --dry-run for a diff, --if-hash <hash>, --commit, and --author):
  append <note> [text...]      add text at the end, or at the end of --heading H (--create-heading, --level)
  section put <note> [text...] replace the body of section --heading H, or add the section
  prop set <note> <key> <value>
                               set one frontmatter key (value read as YAML), keeping comments and order
  put <path> [text...]         create a note, or replace it only with --if-hash (text, --file, or stdin)
  journal append <period> [text...]
                               append to the period's note for --date (default: today)

options:
  --vault <dir>                vault root (default: $NEIRO_VAULT, then the current directory)
  --json                       machine-readable output, the same as --format json
  --format <text|json|paths>   paths prints one path per line, for xargs and fzf
  --fields <a,b,...>           only these fields: summary fields such as score, or any frontmatter key
  --type, --tag, --status, --under <value>
                               filters for search, list, grep, and tags; --tag may repeat,
                               matches case-insensitively, and area matches area/sub
  --where <key=value|key>      filter on any frontmatter property; may repeat; a bare key means present
  --sort <modified|created|title|path>, --desc
                               list order; notes without the value sort last
  --limit <n>                  results for search and find (default 10), or list (default all)
  --max-chars <n>              truncate a note body in get
  --lines <a:b>                get: lines a to b, counted from the top of the file (a:, :b, or one line)
  --around <line|path:line>    get: a line and --context lines either side; accepts rg -n output
  -C, --context <n>            lines either side: for get --around (default 5), and for grep
  -F, --fixed-strings          grep: match the pattern as literal text
  --date <YYYY-MM-DD>          date for journal (default: today)
  --title, --source <value>    capture metadata; --tag may repeat
  --file <path>                capture: a Markdown file, keeping its title, tags, source, and other properties
  --dry-run                    capture and writes: show the result without writing
  --commit                     capture and writes: commit the note, and only it
  --if-hash <sha256>           writes: refuse unless the note still has the hash get returned
  --push                       capture: pull --rebase, commit, and push
  --author <"Name <email>">    capture and writes: commit author
  -h, --help                   show this help
  -v, --version                show the version`;

class UsageError extends Error {}

// A Markdown bullet such as "- read the paper", or a negative number such as -428, is text to write, not an option;
// parseArgs would read either as one.
const BULLET = "\u0000";
const argv = process.argv.slice(2).map((arg) => (/^-(\s|\d|\.\d)/.test(arg) ? `${BULLET}${arg}` : arg));

function parse() {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        vault: { type: "string" },
        json: { type: "boolean" },
        format: { type: "string" },
        fields: { type: "string" },
        type: { type: "string" },
        tag: { type: "string", multiple: true },
        status: { type: "string" },
        under: { type: "string" },
        limit: { type: "string" },
        where: { type: "string", multiple: true },
        sort: { type: "string" },
        desc: { type: "boolean" },
        "max-chars": { type: "string" },
        lines: { type: "string" },
        around: { type: "string" },
        rev: { type: "string" },
        to: { type: "string" },
        context: { type: "string", short: "C" },
        "fixed-strings": { type: "boolean", short: "F" },
        date: { type: "string" },
        title: { type: "string" },
        source: { type: "string" },
        "dry-run": { type: "boolean" },
        file: { type: "string" },
        commit: { type: "boolean" },
        push: { type: "boolean" },
        author: { type: "string" },
        heading: { type: "string" },
        "create-heading": { type: "boolean" },
        level: { type: "string" },
        "if-hash": { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (error) {
    console.error(`neiro: ${(error as Error).message}\n\n${USAGE}`);
    process.exit(2);
  }
}

const parsed = parse();
const opts = parsed.values;
const positionals = parsed.positionals.map((arg) => (arg.startsWith(BULLET) ? arg.slice(BULLET.length) : arg));

function count(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new UsageError(`--${name} must be a positive integer`);
  return parsed;
}

/** Text for a write: the arguments joined, or stdin when there are none. */
async function inputText(words: string[]): Promise<string> {
  const value = words.length > 0 ? words.join(" ") : await text(process.stdin);
  if (value.trim() === "") throw new UsageError("nothing to write: give text or pipe it on stdin");
  return value;
}

function writeOptions(): WriteOptions {
  return { dryRun: opts["dry-run"], ifHash: opts["if-hash"], commit: opts.commit, author: opts.author };
}

function sectionOptions(): SectionWriteOptions {
  const level = opts.level === undefined ? undefined : count("level", opts.level);
  if (level !== undefined && level > 6) throw new UsageError("--level must be 1 to 6");
  return { ...writeOptions(), heading: opts.heading, createHeading: opts["create-heading"], level };
}

/** A write's result: the diff on a dry run, else the path and the new hash for a following --if-hash. */
function emitWrite(result: WriteResult): void {
  emit(result, () =>
    result.written ? `${result.path}\t${result.hash}` : result.diff.trim() === "" ? "no change" : result.diff.trimEnd(),
  );
}

/** `key=value` requires that value; a bare `key` requires only that the property be present. */
function whereConditions(values: string[] | undefined): Record<string, string | null> | undefined {
  if (!values) return undefined;
  const conditions: Record<string, string | null> = {};
  for (const value of values) {
    const at = value.indexOf("=");
    const key = (at === -1 ? value : value.slice(0, at)).trim();
    if (key === "") throw new UsageError("--where takes key=value or key");
    conditions[key] = at === -1 ? null : value.slice(at + 1);
  }
  return conditions;
}

function lineCount(value: string): number {
  if (!/^\d+$/.test(value)) throw new UsageError("--context must be a whole number");
  return Number(value);
}

/** `a:b`, `a:`, `:b`, or one line `a`. */
function lineSpan(value: string): { start?: number; end?: number } {
  const match = /^(\d*):(\d*)$/.exec(value) ?? /^(\d+)()$/.exec(value);
  if (!match || (match[1] === "" && match[2] === "")) throw new UsageError("--lines takes a:b, a:, :b, or a line");
  const start = match[1] ? Number(match[1]) : undefined;
  const end = match[2] ? Number(match[2]) : value.includes(":") ? undefined : start;
  return { start, end };
}

/** A line, `path:line`, or a whole `rg -n` result `path:line:text`. */
function aroundTarget(value: string): { ref?: string; line: number } {
  if (/^\d+$/.test(value)) return { line: Number(value) };
  const match = /^(.+?):(\d+)(?::.*)?$/s.exec(value);
  if (!match) throw new UsageError("--around takes a line or path:line");
  return { ref: match[1], line: Number(match[2]) };
}

function one(args: string[], what: string): string {
  if (args.length !== 1) throw new UsageError(`expected exactly one ${what}`);
  return args[0] as string;
}

const FORMATS = ["text", "json", "paths"];
const format = opts.format ?? (opts.json ? "json" : "text");
const fields = opts.fields?.split(",").map((field) => field.trim());

function emit(value: unknown, human: () => string): void {
  if (format === "paths" || fields) {
    throw new UsageError("--format paths and --fields work with get, search, list, nav, and backlinks");
  }
  console.log(format === "json" ? JSON.stringify(value, null, 2) : human());
}

const cell = (value: unknown) =>
  value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);

/** Emit notes: one path per line with `--format paths`, only the named fields with `--fields`, else `value`. */
async function emitNotes(vault: Vault, notes: { path: string }[], value: unknown, human: () => string): Promise<void> {
  if (format === "paths") return console.log([...new Set(notes.map((note) => note.path))].join("\n"));
  if (!fields) return emit(value, human);
  const rows = await vault.select(notes, fields);
  const selected = Array.isArray(value) ? rows : rows[0];
  if (format === "json") return console.log(JSON.stringify(selected, null, 2));
  console.log(rows.map((row) => Object.values(row).map(cell).join("\t")).join("\n"));
}

async function main(): Promise<void> {
  if (opts.version) return console.log(pkg.version);
  const [command, ...args] = positionals;
  if (opts.help || !command) return console.log(USAGE);

  if (!FORMATS.includes(format)) throw new UsageError(`--format takes ${FORMATS.join(", ")}`);
  const vault = new Vault(opts.vault ?? process.env.NEIRO_VAULT ?? process.cwd());
  // capture reads --tag itself, as tags to write; everywhere else every --tag must match.
  const filter: Filter = {
    type: opts.type,
    tags: command === "capture" ? undefined : opts.tag,
    status: opts.status,
    under: opts.under,
    where: whereConditions(opts.where),
  };

  switch (command) {
    case "get": {
      const around = opts.around === undefined ? undefined : aroundTarget(opts.around);
      if (around?.ref && args.length > 0)
        throw new UsageError("give the note once: as <note> or in --around path:line");
      if (opts.context !== undefined && !around) throw new UsageError("--context needs --around");
      const note = await vault.get(around?.ref ?? one(args, "note"), {
        maxChars: count("max-chars", opts["max-chars"]),
        lines: opts.lines === undefined ? undefined : lineSpan(opts.lines),
        around: around && {
          line: around.line,
          context: opts.context === undefined ? undefined : lineCount(opts.context),
        },
      });
      const where = note.start === undefined ? note.path : `${note.path}:${note.start}-${note.end} of ${note.total}`;
      return emitNotes(vault, [note], note, () => `${where}\n\n${note.body}${note.truncated ? "\n[truncated]" : ""}`);
    }
    case "grep": {
      let hits: GrepHit[];
      try {
        hits = await vault.grep(one(args, "pattern"), {
          ...filter,
          fixed: opts["fixed-strings"],
          context: opts.context === undefined ? undefined : lineCount(opts.context),
        });
      } catch (error) {
        if (error instanceof SyntaxError) throw new UsageError(`invalid pattern: ${error.message}`);
        throw error;
      }
      return emitNotes(vault, hits, hits, () => formatGrep(hits));
    }
    case "search": {
      if (args.length === 0) throw new UsageError("search needs a query");
      const hits = await vault.search(args.join(" "), { ...filter, limit: count("limit", opts.limit) });
      return emitNotes(vault, hits, hits, () =>
        hits.length === 0
          ? "no matches"
          : hits.map((hit) => `${hit.score}\t${hit.path}\t${hit.title}\n\t${hit.snippet}`).join("\n"),
      );
    }
    case "find": {
      if (args.length === 0) throw new UsageError("find needs a query");
      const hits = await vault.suggest(args.join(" "), { ...filter, limit: count("limit", opts.limit) });
      return emitNotes(vault, hits, hits, () =>
        hits.length === 0 ? "no matches" : hits.map((hit) => `${hit.score}\t${hit.path}\t${hit.title}`).join("\n"),
      );
    }
    case "tags": {
      if (args.length > 0) throw new UsageError("tags takes no arguments; narrow it with the filters");
      const counts = await vault.tags(filter);
      return emit(counts, () => counts.map(({ tag, notes }) => `${notes}\t${tag}`).join("\n"));
    }
    case "list": {
      const sort = opts.sort;
      if (sort !== undefined && !(SORT_KEYS as readonly string[]).includes(sort)) {
        throw new UsageError(`--sort takes ${SORT_KEYS.join(", ")}`);
      }
      const notes = await vault.list({
        ...filter,
        sort: sort as (typeof SORT_KEYS)[number] | undefined,
        desc: opts.desc,
        limit: count("limit", opts.limit),
      });
      return emitNotes(vault, notes, notes, () => notes.map((note) => `${note.path}\t${note.title}`).join("\n"));
    }
    case "nav": {
      if (args.length > 1) throw new UsageError("nav takes at most one folder");
      const view = await vault.nav(args[0]);
      const notes = view.index ? [view.index, ...view.notes] : view.notes;
      return emitNotes(vault, notes, view, () =>
        [
          view.index
            ? `${view.index.path}\t${view.index.title}\n${view.index.headings.map((h) => `  # ${h}`).join("\n")}`
            : "",
          ...view.folders.map((folder) => `${folder.path}/\t${folder.title}\t(${folder.notes})`),
          ...view.notes.map((note) => `${note.path}\t${note.title}`),
        ]
          .filter((line) => line !== "")
          .join("\n"),
      );
    }
    case "links": {
      const links = await vault.links(one(args, "note"));
      return emit(links, () =>
        links
          .map(({ target, resolution }) => {
            if (resolution.status === "resolved") return `${target}\t-> ${resolution.path}`;
            if (resolution.status === "ambiguous") return `${target}\tambiguous: ${resolution.candidates.join(", ")}`;
            return `${target}\t${resolution.status}`;
          })
          .join("\n"),
      );
    }
    case "history": {
      const note = await vault.find(one(args, "note"));
      const revisions = vault.history.log(note.path, count("limit", opts.limit));
      return emit(revisions, () =>
        revisions
          .map(({ rev, date, author, message }) => `${rev.slice(0, 12)}\t${date}\t${author}\t${message}`)
          .join("\n"),
      );
    }
    case "show": {
      if (!opts.rev) throw new UsageError("show needs --rev <rev>");
      const note = await vault.find(one(args, "note"));
      const content = vault.history.show(note.path, opts.rev);
      return emit({ path: note.path, rev: opts.rev, content }, () => content.replace(/\n$/, ""));
    }
    case "diff": {
      const note = await vault.find(one(args, "note"));
      const patch = vault.history.diff(note.path, opts.rev ?? "HEAD", opts.to);
      return emit({ path: note.path, from: opts.rev ?? "HEAD", to: opts.to ?? null, diff: patch }, () =>
        patch.replace(/\n$/, ""),
      );
    }
    case "orphans": {
      if (args.length > 0) throw new UsageError("orphans takes no arguments; narrow it with the filters");
      const notes = await vault.orphans(filter);
      return emitNotes(vault, notes, notes, () => notes.map((note) => `${note.path}\t${note.title}`).join("\n"));
    }
    case "outline": {
      const headings = await vault.outline(one(args, "note"));
      return emit(headings, () =>
        headings.map(({ level, text, line }) => `${line}\t${"#".repeat(level)} ${text}`).join("\n"),
      );
    }
    case "prop": {
      const [action, ref, key, ...rest] = args;
      if (action === "set" && ref && key && rest.length > 0) {
        return emitWrite(await vault.setProperty(ref, key, propertyValue(rest.join(" ")), writeOptions()));
      }
      if (action !== "get" || !ref || !key || rest.length > 0) {
        throw new UsageError("usage: prop get <note> <key>, or prop set <note> <key> <value>");
      }
      const value = await vault.property(ref, key);
      return emit(value, () => (typeof value === "string" ? value : JSON.stringify(value)));
    }
    case "put": {
      const [path, ...words] = args;
      if (!path) throw new UsageError("put needs a vault path");
      if (opts.file && words.length > 0) throw new UsageError("put takes text or --file, not both");
      const content = opts.file ? readFileSync(opts.file, "utf8") : await inputText(words);
      return emitWrite(await vault.put(path, content, writeOptions()));
    }
    case "backlinks": {
      const notes = await vault.backlinks(one(args, "note"));
      return emitNotes(vault, notes, notes, () => notes.map((note) => `${note.path}\t${note.title}`).join("\n"));
    }
    case "unresolved": {
      const links = await vault.unresolved();
      return emit(links, () =>
        links.map((link) => `${link.from}\t${link.target}\t${link.resolution.status}`).join("\n"),
      );
    }
    case "append": {
      const [ref, ...words] = args;
      if (!ref) throw new UsageError("append needs a note");
      return emitWrite(await vault.append(ref, await inputText(words), sectionOptions()));
    }
    case "section": {
      const [action, ref, ...words] = args;
      if (action !== "put" || !ref || !opts.heading)
        throw new UsageError("usage: section put <note> --heading H [text]");
      return emitWrite(await vault.putSection(ref, opts.heading, await inputText(words), sectionOptions()));
    }
    case "journal": {
      if (args[0] === "append") {
        const [, period = "", ...words] = args;
        if (!(PERIODS as readonly string[]).includes(period))
          throw new UsageError(`journal append takes ${PERIODS.join(", ")}`);
        const date = opts.date ? parseDate(opts.date) : new Date();
        return emitWrite(
          await vault.appendJournal(period as Period, await inputText(words), { ...sectionOptions(), date }),
        );
      }
      const period = one(args, `period (${PERIODS.join(", ")})`);
      if (!(PERIODS as readonly string[]).includes(period)) throw new UsageError(`journal takes ${PERIODS.join(", ")}`);
      const found = await vault.journalFor(period as Period, opts.date ? parseDate(opts.date) : new Date());
      return emit(found, () => (found.note ? `${found.path}\n\n${found.note.body}` : `${found.path}\tnot written yet`));
    }
    case "new": {
      const [type, ...words] = args;
      if (!type || words.length === 0) throw new UsageError("usage: new <type> <title>");
      const result = await vault.create(type, words.join(" "), {
        tags: opts.tag,
        dryRun: opts["dry-run"],
        commit: opts.commit,
        push: opts.push,
        author: opts.author,
      });
      return emit(result, () => (result.written ? result.path : `${result.path} (dry run)\n\n${result.content}`));
    }
    case "capture": {
      if (opts.file && args.length > 0) throw new UsageError("capture takes text or --file, not both");
      const base = opts.file
        ? captureInputFromMarkdown(readFileSync(opts.file, "utf8"), opts.file)
        : { text: args.length > 0 ? args.join(" ") : await text(process.stdin) };
      const result = await vault.capture(
        {
          ...base,
          title: opts.title ?? base.title,
          tags: [...(base.tags ?? []), ...(opts.tag ?? [])],
          source: opts.source ?? base.source,
        },
        { dryRun: opts["dry-run"], commit: opts.commit, push: opts.push, author: opts.author },
      );
      return emit(result, () => (result.written ? result.path : `${result.path} (dry run)\n\n${result.content}`));
    }
    default:
      throw new UsageError(`unknown command "${command}"`);
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`neiro: ${error.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (
    error instanceof NotFoundError ||
    error instanceof LineRangeError ||
    error instanceof HistoryError ||
    error instanceof SectionError ||
    error instanceof WriteConflictError ||
    error instanceof CaptureError ||
    error instanceof UnsupportedError
  ) {
    console.error(`neiro: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
