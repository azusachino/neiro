import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseToml } from "./providers.ts";

export const CONFIG_FILE = "neiro.toml";
export const PERIODS = ["day", "week", "month", "quarter", "year"] as const;
export type Period = (typeof PERIODS)[number];

export { UnsupportedError } from "./chain.ts";

/** Where the notes of one period live: `folder` plus a moment-style `format`, which may contain `/`. */
export interface PeriodicSetting {
  folder: string;
  format: string;
  /** Which settings source supplied this, for error messages and debugging. */
  source: string;
}

export interface CaptureSettings {
  /** Folder for new notes, relative to the vault root; `""` is the root. */
  folder: string;
  /** `title` names the file after the note's title, as Obsidian does; `slug` uses an ASCII kebab-case stem. */
  filename: "title" | "slug";
  /** Frontmatter keys in the order written. `title`, `created`, `modified`, `tags`, and `source` are filled by capture; other keys come from `values`. */
  properties: string[];
  values: Record<string, string>;
  /** moment-style format for `created` and `modified`. */
  timestampFormat: string;
  /** `lowercase` lowercases title words except `titleAllow` entries and spaces Latin text apart from CJK text. */
  titleStyle: "as-written" | "lowercase";
  titleAllow: string[];
  /** `kebab` canonicalizes tags to lowercase kebab-case; `as-written` keeps them, checking Obsidian's tag syntax. */
  tagStyle: "as-written" | "kebab";
  requireTags: boolean;
  rejectTags: string[];
}

export interface VaultSettings {
  capture: CaptureSettings;
  journal: Partial<Record<Period, PeriodicSetting>>;
}

/** The shape of `neiro.toml`, also accepted in code. Every key is optional. */
export interface NeiroConfig {
  capture?: {
    folder?: string;
    filename?: "title" | "slug";
    properties?: string[];
    values?: Record<string, string>;
    timestamp_format?: string;
    title_style?: "as-written" | "lowercase";
    /** A TOML file whose string arrays list title words to keep as written, relative to the vault root. */
    title_allowlist?: string;
    tag_style?: "as-written" | "kebab";
    require_tags?: boolean;
    reject_tags?: string[];
  };
  journal?: Partial<Record<Period, { folder?: string; format?: string }>>;
}

const DEFAULT_CAPTURE: Omit<CaptureSettings, "folder"> = {
  filename: "title",
  properties: ["tags", "source"],
  values: {},
  timestampFormat: "YYYY-MM-DD HH:mm",
  titleStyle: "as-written",
  titleAllow: [],
  tagStyle: "as-written",
  requireTags: false,
  rejectTags: [],
};

const PERIODIC_NOTES_KEYS: Record<Period, string> = {
  day: "daily",
  week: "weekly",
  month: "monthly",
  quarter: "quarterly",
  year: "yearly",
};

function readJson(root: string, path: string): Record<string, unknown> | undefined {
  const file = join(root, path);
  if (!existsSync(file)) return undefined;
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function readToml(root: string, path: string): unknown {
  return parseToml.get()(readFileSync(join(root, path), "utf8"));
}

function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(stringsIn);
  return [];
}

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** Obsidian's "Default location for new notes": a folder only when set to "In the folder specified below". */
function obsidianNewNoteFolder(root: string): string | undefined {
  const app = readJson(root, ".obsidian/app.json");
  return app?.newFileLocation === "folder" ? text(app.newFileFolderPath) : undefined;
}

/** Periodic Notes (0.0.x settings) first, then Obsidian's core Daily Notes for days. */
function obsidianJournal(root: string, period: Period): PeriodicSetting | undefined {
  const periodic = readJson(root, ".obsidian/plugins/periodic-notes/data.json");
  const entry = periodic?.[PERIODIC_NOTES_KEYS[period]] as Record<string, unknown> | undefined;
  if (entry?.enabled === true && text(entry.format)) {
    return { folder: text(entry.folder) ?? "", format: text(entry.format) as string, source: "Periodic Notes" };
  }
  if (period !== "day") return undefined;
  const daily = readJson(root, ".obsidian/daily-notes.json");
  const corePlugins = readJson(root, ".obsidian/core-plugins.json");
  if (!daily && corePlugins?.["daily-notes"] !== true) return undefined;
  return { folder: text(daily?.folder) ?? "", format: text(daily?.format) || "YYYY-MM-DD", source: "Daily Notes" };
}

/**
 * Resolve settings by precedence: options passed in code, then `neiro.toml`, then the vault's own Obsidian settings,
 * then neutral defaults. A journal period with no source stays unset, and using it raises `UnsupportedError`.
 */
export function resolveSettings(root: string, code: NeiroConfig = {}): VaultSettings {
  const file: NeiroConfig = existsSync(join(root, CONFIG_FILE)) ? (readToml(root, CONFIG_FILE) as NeiroConfig) : {};
  const capture = { ...file.capture, ...code.capture };
  const allowFile = capture.title_allowlist;

  const journal: Partial<Record<Period, PeriodicSetting>> = {};
  for (const period of PERIODS) {
    const configured = code.journal?.[period] ?? file.journal?.[period];
    const source = code.journal?.[period] ? "options" : CONFIG_FILE;
    const setting = configured?.format
      ? { folder: configured.folder ?? "", format: configured.format, source }
      : obsidianJournal(root, period);
    if (setting) journal[period] = setting;
  }

  return {
    capture: {
      folder: capture.folder ?? obsidianNewNoteFolder(root) ?? "",
      filename: capture.filename ?? DEFAULT_CAPTURE.filename,
      properties: capture.properties ?? DEFAULT_CAPTURE.properties,
      values: capture.values ?? DEFAULT_CAPTURE.values,
      timestampFormat: capture.timestamp_format ?? DEFAULT_CAPTURE.timestampFormat,
      titleStyle: capture.title_style ?? DEFAULT_CAPTURE.titleStyle,
      titleAllow: allowFile ? stringsIn(readToml(root, allowFile)) : DEFAULT_CAPTURE.titleAllow,
      tagStyle: capture.tag_style ?? DEFAULT_CAPTURE.tagStyle,
      requireTags: capture.require_tags ?? DEFAULT_CAPTURE.requireTags,
      rejectTags: capture.reject_tags ?? DEFAULT_CAPTURE.rejectTags,
    },
    journal,
  };
}
