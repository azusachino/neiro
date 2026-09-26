/**
 * The journal (ADR 0020): the day, week, month, quarter, or year note for a date, found by a folder and a moment-style
 * format per period, as Obsidian's Daily Notes and the Periodic Notes plugin name them. A vault enables it with
 * `extensions = ["tsuzuri:journal"]` and declares `[journal.<period>] folder` and `format`.
 */
import { defineExtension, defineOperation } from "../extension.ts";
import {
  ConfigError,
  formatDate,
  InputError,
  type NoteContent,
  NotFoundError,
  UnsupportedError,
  type Vault,
  type WriteResult,
} from "../index.ts";

const PERIODS = ["day", "week", "month", "quarter", "year"] as const;
type Period = (typeof PERIODS)[number];
type Periods = Partial<Record<Period, { folder: string; format: string }>>;

const isTable = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function periods(table: Record<string, unknown> | undefined, source: string): Periods {
  const parsed: Periods = {};
  for (const [period, entry] of Object.entries(table ?? {})) {
    if (!(PERIODS as readonly string[]).includes(period)) {
      throw new ConfigError(`${source}: unknown key journal.${period}; journal takes ${PERIODS.join(", ")}`);
    }
    if (!isTable(entry)) throw new ConfigError(`${source}: journal.${period} must be a table`);
    for (const [key, value] of Object.entries(entry)) {
      if (key !== "folder" && key !== "format") {
        throw new ConfigError(
          `${source}: unknown key journal.${period}.${key}; journal.${period} takes folder, format`,
        );
      }
      if (typeof value !== "string") throw new ConfigError(`${source}: journal.${period}.${key} must be a string`);
    }
    if (typeof entry.format === "string") {
      parsed[period as Period] = { folder: typeof entry.folder === "string" ? entry.folder : "", format: entry.format };
    }
  }
  return parsed;
}

/** `YYYY-MM-DD` as a local calendar date; today when unset. */
function dateOf(text: unknown): Date {
  if (text === undefined) return new Date();
  const match = typeof text === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) : null;
  if (!match) throw new InputError(`expected a date as YYYY-MM-DD, got "${String(text)}"`);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getMonth() !== Number(match[2]) - 1) throw new InputError(`not a calendar date: "${text}"`);
  return date;
}

function pathFor(settings: unknown, period: unknown, date: Date): { period: Period; path: string } {
  if (!(PERIODS as readonly unknown[]).includes(period)) throw new InputError(`period must be ${PERIODS.join(", ")}`);
  const setting = (settings as Periods)[period as Period];
  if (!setting) {
    throw new UnsupportedError(
      `no ${period} journal settings: set [journal.${period}] folder and format in tsuzuri.toml`,
    );
  }
  const folder = setting.folder.replace(/^\/+|\/+$/g, "");
  const name = `${formatDate(date, setting.format)}.md`;
  return { period: period as Period, path: folder === "" ? name : `${folder}/${name}` };
}

/** The note at `path`, or `null` when it is not written yet. */
async function noteAt(vault: Vault, path: string): Promise<NoteContent | null> {
  try {
    return await vault.get(path);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

const PERIOD = { type: "string", description: "Which note", enum: PERIODS, required: true } as const;
const DATE = { type: "string", description: "The date, YYYY-MM-DD; today by default" } as const;

export default defineExtension({
  name: "journal",
  table: "journal",
  settings: periods,
  operations: [
    defineOperation({
      name: "journal",
      kind: "read",
      command: "journal",
      summary: "The periodic note for a date: its path, and its content when written.",
      input: { period: PERIOD, date: DATE },
      async run(vault, input, { settings }) {
        const { path } = pathFor(settings, input.period, dateOf(input.date));
        return { path, note: await noteAt(vault, path) };
      },
      format(result) {
        const { path, note } = result as { path: string; note: NoteContent | null };
        return note ? `${path}\n\n${note.body}` : `${path}\tnot written yet`;
      },
    }),
    defineOperation({
      name: "journalAppend",
      kind: "edit",
      command: "journal append",
      summary: "Add text to the periodic note for a date, at its end or under a heading. The note must exist.",
      input: {
        period: PERIOD,
        text: { type: "string", description: "Text to add, such as a bullet", required: true },
        heading: { type: "string", description: "The section to add under" },
        date: DATE,
        dryRun: { type: "boolean", description: "Return the unified diff without writing" },
        ifHash: { type: "string", description: "Write only if the note still has this hash, as get returned it" },
      },
      async run(vault, input, { settings }) {
        const { period, path } = pathFor(settings, input.period, dateOf(input.date));
        if (!(await noteAt(vault, path))) {
          throw new NotFoundError(`${path} is not written yet; the ${period} note must exist to append to it`);
        }
        return vault.append(path, input.text as string, {
          heading: input.heading as string | undefined,
          dryRun: input.dryRun as boolean | undefined,
          ifHash: input.ifHash as string | undefined,
        });
      },
      format(result) {
        const write = result as WriteResult;
        return write.written ? `${write.path}\t${write.hash}` : write.diff.trimEnd();
      },
    }),
  ],
});
