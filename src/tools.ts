/**
 * Ready-made agent tools over a `Vault`: a name, a JSON Schema for the input, MCP-style hints, an exposure, and a
 * `run` bound to the SDK. A consumer registers `agentTools()` with its model and routes calls to `run`.
 */
import { parseDate } from "./dateformat.ts";
import { InputError } from "./errors.ts";
import { propertyValue } from "./frontmatter.ts";
import { PartialWriteError } from "./history.ts";
import { PERIODS, type Period } from "./settings.ts";
import { SORT_KEYS, type Vault } from "./vault.ts";

/** `direct`: an agent may call it; `confirm`: only after a human approves the call; `cli-only`: never offered. */
export type Exposure = "direct" | "confirm" | "cli-only";

export interface PropertySchema {
  type: "string" | "integer" | "boolean" | "array" | "object";
  description: string;
  enum?: readonly string[];
  items?: { type: "string" };
  minimum?: number;
  /** For an object: the JSON types its values may take. */
  additionalProperties?: { type: readonly ("string" | "null")[] };
}

export interface InputSchema {
  type: "object";
  properties: Record<string, PropertySchema>;
  required: string[];
  additionalProperties: false;
}

export interface ToolDefinition {
  /** `neiro_` and a snake_case verb, valid for every major tool-calling API. */
  name: string;
  description: string;
  inputSchema: InputSchema;
  /** The Model Context Protocol's tool annotations. */
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean };
  exposure: Exposure;
  run(vault: Vault, input: Record<string, unknown>, context?: ToolContext): Promise<unknown>;
}

/** How writes are recorded, decided by the consumer rather than the model. */
export interface ToolContext {
  /** Commit each write, as one revision of the note alone. */
  commit?: boolean;
  /** Pull before and push after each write, through `History`, so `ifHash` meets the remote's latest. Implies `commit`. */
  push?: boolean;
  /** Commit author, as `Name <email>`. */
  author?: string;
}

export class ToolInputError extends InputError {}

const str = (description: string): PropertySchema => ({ type: "string", description });
const int = (description: string): PropertySchema => ({ type: "integer", description, minimum: 1 });
const bool = (description: string): PropertySchema => ({ type: "boolean", description });
const list = (description: string): PropertySchema => ({ type: "array", description, items: { type: "string" } });

function schema(properties: Record<string, PropertySchema>, required: string[] = []): InputSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

const NOTE = str("A note: its vault path, file name, title, or alias");
const FILTERS = {
  type: str("Only notes whose type property is this"),
  tags: list("Only notes carrying every one of these tags; a parent tag matches its nested tags"),
  status: str("Only notes whose status property is this"),
  under: str("Only notes in this folder, such as note/tech"),
};
const GUARDS = {
  dryRun: bool("Return the unified diff without writing"),
  ifHash: str("Write only if the note still has this hash, as get returned it"),
};
/** The longest pattern `neiro_grep` takes from a model. */
const GREP_PATTERN_LIMIT = 200;
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };

/** Check `input` against a tool's schema, so a model's mistake comes back as a clear error, not a crash. */
export function validateInput(tool: ToolDefinition, input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ToolInputError(`${tool.name} takes an object`);
  }
  const record = input as Record<string, unknown>;
  const { properties, required } = tool.inputSchema;
  for (const key of required) {
    if (record[key] === undefined) throw new ToolInputError(`${tool.name} needs ${key}`);
  }
  for (const [key, value] of Object.entries(record)) {
    const property = properties[key];
    if (!property) throw new ToolInputError(`${tool.name} has no input ${key}`);
    if (value === undefined) continue;
    const ok =
      property.type === "array"
        ? Array.isArray(value) && value.every((item) => typeof item === "string")
        : property.type === "integer"
          ? Number.isInteger(value) && (value as number) >= (property.minimum ?? Number.NEGATIVE_INFINITY)
          : property.type === "object"
            ? typeof value === "object" && value !== null && !Array.isArray(value)
            : typeof value === property.type;
    if (!ok) throw new ToolInputError(`${tool.name}: ${key} must be ${property.type}`);
    const values = property.additionalProperties?.type;
    if (
      values &&
      !Object.values(value as object).every((item) =>
        values.includes(item === null ? "null" : (typeof item as "string")),
      )
    ) {
      throw new ToolInputError(`${tool.name}: ${key} values must be ${values.join(" or ")}`);
    }
    if (property.enum && !property.enum.includes(value as string)) {
      throw new ToolInputError(`${tool.name}: ${key} must be one of ${property.enum.join(", ")}`);
    }
  }
  return record;
}

const s = (input: Record<string, unknown>, key: string) => input[key] as string;
const o = <T>(input: Record<string, unknown>, key: string) => input[key] as T | undefined;
const filterOf = (input: Record<string, unknown>) => ({
  type: o<string>(input, "type"),
  tags: o<string[]>(input, "tags"),
  status: o<string>(input, "status"),
  under: o<string>(input, "under"),
});
const dateOf = (input: Record<string, unknown>) => {
  const date = o<string>(input, "date");
  return date ? parseDate(date) : new Date();
};

/** A write's options: the model's guards, the consumer's commit policy. */
function writeOf(input: Record<string, unknown>, context: ToolContext = {}) {
  return {
    dryRun: o<boolean>(input, "dryRun"),
    ifHash: o<string>(input, "ifHash"),
    commit: context.commit || context.push,
    author: context.author,
  };
}

/** With push: take the remote's revisions before the write, so its guards see them, and publish the write after. */
async function published<T extends { path: string; hash: string; committed: boolean }>(
  vault: Vault,
  context: ToolContext = {},
  write: () => Promise<T>,
): Promise<T> {
  if (context.push) await vault.sync();
  const result = await write();
  if (context.push && result.committed) {
    try {
      await vault.sync();
    } catch (error) {
      throw new PartialWriteError(result, error);
    }
  }
  return result;
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "neiro_get",
    description: "Read one note: its summary, frontmatter, body, and hash. lines or around read part of it by line.",
    inputSchema: schema(
      {
        note: NOTE,
        lines: str("An inclusive line range such as 20:60, 20:, or :60, counted from the top of the file"),
        around: int("A line to read around, as rg -n or neiro_grep numbers it"),
        context: { type: "integer", description: "Lines either side of around; 5 by default", minimum: 0 },
        maxChars: int("Truncate the returned body to this many characters"),
      },
      ["note"],
    ),
    annotations: READ,
    exposure: "direct",
    run: async (vault, input) => {
      const lines = o<string>(input, "lines");
      if (lines !== undefined && !/^(?:\d+:\d*|:\d+|\d+)$/.test(lines)) {
        throw new ToolInputError(`neiro_get: lines must be a:b, a:, :b, or a line, not "${lines}"`);
      }
      const span = lines?.split(":");
      const around = o<number>(input, "around");
      return vault.get(s(input, "note"), {
        maxChars: o<number>(input, "maxChars"),
        lines: span ? { start: Number(span[0]) || undefined, end: Number(span[1] ?? span[0]) || undefined } : undefined,
        around: around === undefined ? undefined : { line: around, context: o<number>(input, "context") },
      });
    },
  },
  {
    name: "neiro_search",
    description: "Rank notes by relevance to words (BM25; CJK matches as substrings). Returns summaries with snippets.",
    inputSchema: schema({ query: str("Words to look for"), limit: int("Most results; 10 by default"), ...FILTERS }, [
      "query",
    ]),
    annotations: READ,
    exposure: "direct",
    run: (vault, input) => vault.search(s(input, "query"), { ...filterOf(input), limit: o<number>(input, "limit") }),
  },
  {
    name: "neiro_grep",
    description:
      "Lines containing text, as path, line, and text; smart case. Literal unless regex is set. Read around a hit next.",
    inputSchema: schema(
      {
        pattern: str(`Text to find, at most ${GREP_PATTERN_LIMIT} characters; a regular expression with regex`),
        regex: bool("Read the pattern as a JavaScript regular expression instead of literal text"),
        context: { type: "integer", description: "Lines of context either side", minimum: 0 },
        ...FILTERS,
      },
      ["pattern"],
    ),
    annotations: READ,
    exposure: "direct",
    run: async (vault, input) => {
      const pattern = s(input, "pattern");
      // A model's regular expression runs in the host's process; literal text by default and a length cap keep a
      // backtracking pattern from stalling it.
      if (pattern.length > GREP_PATTERN_LIMIT) {
        throw new ToolInputError(`neiro_grep: pattern is longer than ${GREP_PATTERN_LIMIT} characters`);
      }
      try {
        return await vault.grep(pattern, {
          ...filterOf(input),
          fixed: o<boolean>(input, "regex") !== true,
          context: o<number>(input, "context"),
        });
      } catch (error) {
        if (error instanceof SyntaxError) throw new ToolInputError(`neiro_grep: ${error.message}`);
        throw error;
      }
    },
  },
  {
    name: "neiro_find",
    description: "Fuzzy-match notes by path, title, or alias, for a loose reference such as a half-remembered name.",
    inputSchema: schema({ query: str("A loose name, abbreviation, or typo"), limit: int("Most results") }, ["query"]),
    annotations: READ,
    exposure: "direct",
    run: (vault, input) => vault.suggest(s(input, "query"), { limit: o<number>(input, "limit") }),
  },
  {
    name: "neiro_list",
    description: "List note summaries, filtered on any frontmatter property and sorted, such as the latest books.",
    inputSchema: schema({
      ...FILTERS,
      where: {
        type: "object",
        description: "Frontmatter key to required text value; null asks only for presence",
        additionalProperties: { type: ["string", "null"] },
      },
      sort: { type: "string", description: "Sort key", enum: SORT_KEYS },
      desc: bool("Sort descending"),
      limit: int("Most results"),
    }),
    annotations: READ,
    exposure: "direct",
    run: (vault, input) =>
      vault.list({
        ...filterOf(input),
        where: o<Record<string, string | null>>(input, "where"),
        sort: o<(typeof SORT_KEYS)[number]>(input, "sort"),
        desc: o<boolean>(input, "desc"),
        limit: o<number>(input, "limit"),
      }),
  },
  {
    name: "neiro_nav",
    description: "A folder's index note and headings, subfolders, and notes: how the vault is laid out.",
    inputSchema: schema({ folder: str("A folder; the vault root by default") }),
    annotations: READ,
    exposure: "direct",
    run: (vault, input) => vault.nav(o<string>(input, "folder")),
  },
  {
    name: "neiro_links",
    description: "A note's outgoing wikilinks and what each resolves to.",
    inputSchema: schema({ note: NOTE }, ["note"]),
    annotations: READ,
    exposure: "direct",
    run: (vault, input) => vault.links(s(input, "note")),
  },
  {
    name: "neiro_backlinks",
    description: "Notes that link to a note.",
    inputSchema: schema({ note: NOTE }, ["note"]),
    annotations: READ,
    exposure: "direct",
    run: (vault, input) => vault.backlinks(s(input, "note")),
  },
  {
    name: "neiro_tags",
    description: "Every tag with its note count. Reuse one of these instead of inventing a near-duplicate.",
    inputSchema: schema({ ...FILTERS }),
    annotations: READ,
    exposure: "direct",
    run: (vault, input) => vault.tags(filterOf(input)),
  },
  {
    name: "neiro_outline",
    description: "A note's headings with their levels and line numbers.",
    inputSchema: schema({ note: NOTE }, ["note"]),
    annotations: READ,
    exposure: "direct",
    run: (vault, input) => vault.outline(s(input, "note")),
  },
  {
    name: "neiro_prop_get",
    description: "One frontmatter value of a note.",
    inputSchema: schema({ note: NOTE, key: str("The property") }, ["note", "key"]),
    annotations: READ,
    exposure: "direct",
    run: (vault, input) => vault.property(s(input, "note"), s(input, "key")),
  },
  {
    name: "neiro_journal",
    description: "The periodic note for a date: its path, and its content when written.",
    inputSchema: schema(
      {
        period: { type: "string", description: "Which note", enum: PERIODS },
        date: str("YYYY-MM-DD; today by default"),
      },
      ["period"],
    ),
    annotations: READ,
    exposure: "direct",
    run: (vault, input) => vault.journalFor(s(input, "period") as Period, dateOf(input)),
  },
  {
    name: "neiro_history",
    description: "A note's revisions, newest first.",
    inputSchema: schema({ note: NOTE, limit: int("Most revisions; 20 by default") }, ["note"]),
    annotations: READ,
    exposure: "direct",
    run: async (vault, input) =>
      vault.history.log((await vault.find(s(input, "note"))).path, o<number>(input, "limit")),
  },
  {
    name: "neiro_capture",
    description: "Create one new note in the vault's inbox or capture folder. Never edits an existing note.",
    inputSchema: schema(
      {
        text: str("The note body"),
        title: str("A title; the first line of text by default"),
        tags: list("Tags, preferably ones neiro_tags lists"),
        source: str("Where the note came from, such as a URL"),
        dryRun: GUARDS.dryRun,
      },
      ["text"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    exposure: "direct",
    run: (vault, input, context = {}) =>
      vault.capture(
        { text: s(input, "text"), title: o(input, "title"), tags: o(input, "tags"), source: o(input, "source") },
        { dryRun: o(input, "dryRun"), commit: context.commit, push: context.push, author: context.author },
      ),
  },
  {
    name: "neiro_journal_append",
    description: "Add text to the periodic note for a date, at its end or under a heading. The note must exist.",
    inputSchema: schema(
      {
        period: { type: "string", description: "Which note", enum: PERIODS },
        text: str("Text to add, such as a bullet"),
        heading: str("The section to add under"),
        date: str("YYYY-MM-DD; today by default"),
        ...GUARDS,
      },
      ["period", "text"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    exposure: "direct",
    run: async (vault, input, context) =>
      published(vault, context, () =>
        vault.appendJournal(s(input, "period") as Period, s(input, "text"), {
          ...writeOf(input, context),
          heading: o(input, "heading"),
          date: dateOf(input),
        }),
      ),
  },
  {
    name: "neiro_append",
    description: "Add text to the end of a note, or to the end of one section. Changes nothing else.",
    inputSchema: schema(
      {
        note: NOTE,
        text: str("Text to add"),
        heading: str("The section to add under"),
        createHeading: bool("Add the heading at the end of the note when it is missing"),
        ...GUARDS,
      },
      ["note", "text"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    exposure: "confirm",
    run: async (vault, input, context) =>
      published(vault, context, () =>
        vault.append(s(input, "note"), s(input, "text"), {
          ...writeOf(input, context),
          heading: o(input, "heading"),
          createHeading: o(input, "createHeading"),
        }),
      ),
  },
  {
    name: "neiro_section_put",
    description: "Replace one section's body, or add the section. Every other section stays byte-identical.",
    inputSchema: schema({ note: NOTE, heading: str("The section"), text: str("The new body"), ...GUARDS }, [
      "note",
      "heading",
      "text",
    ]),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    exposure: "confirm",
    run: async (vault, input, context) =>
      published(vault, context, () =>
        vault.putSection(s(input, "note"), s(input, "heading"), s(input, "text"), writeOf(input, context)),
      ),
  },
  {
    name: "neiro_prop_set",
    description: "Set one frontmatter property, keeping comments, key order, and every other line.",
    inputSchema: schema(
      {
        note: NOTE,
        key: str("The property"),
        value: str("The value, read as YAML: 4 is a number, [a, b] a list"),
        ...GUARDS,
      },
      ["note", "key", "value"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    exposure: "confirm",
    run: async (vault, input, context) =>
      published(vault, context, () =>
        vault.setProperty(s(input, "note"), s(input, "key"), propertyValue(s(input, "value")), writeOf(input, context)),
      ),
  },
  {
    name: "neiro_new",
    description: "Create a note from the vault's template for a type, placed as a capture is.",
    inputSchema: schema(
      {
        type: str("The template type, such as book"),
        title: str("The new note's title"),
        tags: list("Extra tags"),
        dryRun: GUARDS.dryRun,
      },
      ["type", "title"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    exposure: "confirm",
    run: (vault, input, context = {}) =>
      vault.create(s(input, "type"), s(input, "title"), {
        tags: o(input, "tags"),
        dryRun: o(input, "dryRun"),
        commit: context.commit,
        push: context.push,
        author: context.author,
      }),
  },
  {
    name: "neiro_put",
    description: "Write a whole note: create it, or replace it only with the hash get returned.",
    inputSchema: schema({ path: str("A vault path ending in .md"), content: str("The whole note"), ...GUARDS }, [
      "path",
      "content",
    ]),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    exposure: "cli-only",
    run: async (vault, input, context) =>
      published(vault, context, () => vault.put(s(input, "path"), s(input, "content"), writeOf(input, context))),
  },
];

/** The default exposure of every tool, as the roadmap proposes it; pass a changed copy to `agentTools`. */
export const DEFAULT_EXPOSURE: Readonly<Record<string, Exposure>> = Object.fromEntries(
  TOOLS.map((tool) => [tool.name, tool.exposure]),
);

/** The tools an agent may be offered under an exposure: everything but `cli-only`, each carrying its exposure. */
export function agentTools(exposure: Record<string, Exposure> = DEFAULT_EXPOSURE): ToolDefinition[] {
  return TOOLS.map((tool) => ({ ...tool, exposure: exposure[tool.name] ?? tool.exposure })).filter(
    (tool) => tool.exposure !== "cli-only",
  );
}
