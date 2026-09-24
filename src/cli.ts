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
  NotFoundError,
  PERIODS,
  type Period,
  parseDate,
  UnsupportedError,
  Vault,
} from "./index.ts";

const USAGE = `neiro ${pkg.version}: read and capture into an Obsidian-compatible Markdown vault

usage: neiro <command> [options]

commands:
  get <note>                   print one note (path, filename, title, or alias)
  search <query...>            rank notes by relevance
  list                         list notes matching the filters
  nav [folder]                 a folder's index, subfolders, and notes
  links <note>                 outgoing wikilinks and how each resolves
  backlinks <note>             notes that link to a note
  unresolved                   links pointing at no note, or at several
  journal <period>             the day, week, month, quarter, or year note for a date
  capture [text...]            create a new note from text, --file, or stdin

options:
  --vault <dir>                vault root (default: $NEIRO_VAULT, then the current directory)
  --json                       machine-readable output, the same as --format json
  --format <text|json|paths>   paths prints one path per line, for xargs and fzf
  --fields <a,b,...>           only these fields: summary fields such as score, or any frontmatter key
  --type, --tag, --status, --under <value>
                               filters for search and list
  --limit <n>                  search results (default 10)
  --max-chars <n>              truncate a note body in get
  --date <YYYY-MM-DD>          date for journal (default: today)
  --title, --source <value>    capture metadata; --tag may repeat
  --file <path>                capture: a Markdown file, keeping its title, tags, source, and other properties
  --dry-run                    capture: show the note without writing
  --commit                     capture: commit the new note
  --push                       capture: pull --rebase, commit, and push
  --author <"Name <email>">    capture: commit author
  -h, --help                   show this help
  -v, --version                show the version`;

class UsageError extends Error {}

function parse() {
  try {
    return parseArgs({
      args: process.argv.slice(2),
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
        "max-chars": { type: "string" },
        date: { type: "string" },
        title: { type: "string" },
        source: { type: "string" },
        "dry-run": { type: "boolean" },
        file: { type: "string" },
        commit: { type: "boolean" },
        push: { type: "boolean" },
        author: { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (error) {
    console.error(`neiro: ${(error as Error).message}\n\n${USAGE}`);
    process.exit(2);
  }
}

const { values: opts, positionals } = parse();

function count(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new UsageError(`--${name} must be a positive integer`);
  return parsed;
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
  if (format === "paths") return console.log(notes.map((note) => note.path).join("\n"));
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
  const filter: Filter = { type: opts.type, tag: opts.tag?.[0], status: opts.status, under: opts.under };

  switch (command) {
    case "get": {
      const note = await vault.get(one(args, "note"), { maxChars: count("max-chars", opts["max-chars"]) });
      return emitNotes(
        vault,
        [note],
        note,
        () => `${note.path}\n\n${note.body}${note.truncated ? "\n[truncated]" : ""}`,
      );
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
    case "list": {
      const notes = await vault.list(filter);
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
    case "journal": {
      const period = one(args, `period (${PERIODS.join(", ")})`);
      if (!(PERIODS as readonly string[]).includes(period)) throw new UsageError(`journal takes ${PERIODS.join(", ")}`);
      const found = await vault.journalFor(period as Period, opts.date ? parseDate(opts.date) : new Date());
      return emit(found, () => (found.note ? `${found.path}\n\n${found.note.body}` : `${found.path}\tnot written yet`));
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
  if (error instanceof NotFoundError || error instanceof CaptureError || error instanceof UnsupportedError) {
    console.error(`neiro: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
