import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigError } from "./errors.ts";
import { parseToml } from "./providers.ts";

export const CONFIG_FILE = "tsuzuri.toml";
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
  /** moment-style format for `created` and `modified`; `YYYY-MM-DD` by default, the format of Obsidian's Date property. */
  timestampFormat: string;
  /** `lowercase` lowercases title words except `titleAllow` entries and spaces Latin text apart from CJK text. */
  titleStyle: "as-written" | "lowercase";
  titleAllow: string[];
  /** `kebab` canonicalizes tags to lowercase kebab-case; `as-written` keeps them, checking Obsidian's tag syntax. */
  tagStyle: "as-written" | "kebab";
  requireTags: boolean;
  rejectTags: string[];
}

/** Where note templates live and how their `{{date}}` and `{{time}}` placeholders are written. */
export interface TemplateSettings {
  folder: string;
  dateFormat: string;
  timeFormat: string;
  /** Which settings source supplied the folder. */
  source: string;
}

export interface VaultSettings {
  capture: CaptureSettings;
  journal: Partial<Record<Period, PeriodicSetting>>;
  /** Unset when no source names a template folder; `new` then raises `UnsupportedError`. */
  templates?: TemplateSettings;
}

/** The shape of `tsuzuri.toml`, also accepted in code. Every key is optional. */
export interface TsuzuriConfig {
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
  templates?: { folder?: string; date_format?: string; time_format?: string };
}

const DEFAULT_CAPTURE: Omit<CaptureSettings, "folder"> = {
  filename: "title",
  properties: ["tags", "source"],
  values: {},
  timestampFormat: "YYYY-MM-DD",
  titleStyle: "as-written",
  titleAllow: [],
  tagStyle: "as-written",
  requireTags: false,
  rejectTags: [],
};

function readToml(root: string, path: string): unknown {
  try {
    return parseToml.get()(readFileSync(join(root, path), "utf8"));
  } catch (error) {
    throw new ConfigError(`${path}: ${(error as Error).message.split("\n")[0]}`);
  }
}

function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(stringsIn);
  return [];
}

/** A setting's allowed value: a type, or the strings an enum accepts. */
type Rule = "string" | "boolean" | "strings" | "string table" | readonly string[];

const RULES: Record<string, Record<string, Rule>> = {
  capture: {
    folder: "string",
    filename: ["title", "slug"],
    properties: "strings",
    values: "string table",
    timestamp_format: "string",
    title_style: ["as-written", "lowercase"],
    title_allowlist: "string",
    tag_style: ["as-written", "kebab"],
    require_tags: "boolean",
    reject_tags: "strings",
  },
  templates: { folder: "string", date_format: "string", time_format: "string" },
};
const JOURNAL_RULES: Record<string, Rule> = { folder: "string", format: "string" };

const isTable = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function fits(value: unknown, rule: Rule): boolean {
  if (Array.isArray(rule)) return rule.includes(value as string);
  if (rule === "strings") return Array.isArray(value) && value.every((item) => typeof item === "string");
  if (rule === "string table") return isTable(value) && Object.values(value).every((item) => typeof item === "string");
  return typeof value === rule;
}

function checkTable(value: unknown, rules: Record<string, Rule>, path: string, source: string): void {
  if (!isTable(value)) throw new ConfigError(`${source}: ${path} must be a table`);
  for (const [key, setting] of Object.entries(value)) {
    const rule = rules[key];
    if (!rule) {
      throw new ConfigError(`${source}: unknown key ${path}.${key}; ${path} takes ${Object.keys(rules).join(", ")}`);
    }
    if (!fits(setting, rule)) {
      const wanted = Array.isArray(rule)
        ? `one of ${rule.join(", ")}`
        : `a ${rule === "strings" ? "list of strings" : rule}`;
      throw new ConfigError(`${source}: ${path}.${key} must be ${wanted}`);
    }
  }
}

/** Check settings against the shape of `tsuzuri.toml`, so a misspelled key or value fails instead of being ignored. */
function checkConfig(config: unknown, source: string): TsuzuriConfig {
  if (!isTable(config)) throw new ConfigError(`${source}: settings must be a table`);
  for (const [section, value] of Object.entries(config)) {
    if (section === "journal") {
      if (!isTable(value)) throw new ConfigError(`${source}: journal must be a table`);
      for (const [period, entry] of Object.entries(value)) {
        if (!(PERIODS as readonly string[]).includes(period)) {
          throw new ConfigError(`${source}: unknown key journal.${period}; journal takes ${PERIODS.join(", ")}`);
        }
        checkTable(entry, JOURNAL_RULES, `journal.${period}`, source);
      }
      continue;
    }
    const rules = RULES[section];
    if (!rules) throw new ConfigError(`${source}: unknown key ${section}; settings take capture, journal, templates`);
    checkTable(value, rules, section, source);
  }
  return config as TsuzuriConfig;
}

/**
 * Resolve settings by precedence: options passed in code, then `tsuzuri.toml`, then neutral defaults (ADR 0011). A
 * journal period with no setting stays unset, and using it raises `UnsupportedError`.
 */
export function resolveSettings(root: string, code: TsuzuriConfig = {}): VaultSettings {
  const file = existsSync(join(root, CONFIG_FILE)) ? checkConfig(readToml(root, CONFIG_FILE), CONFIG_FILE) : {};
  checkConfig(code, "options");
  const capture = { ...file.capture, ...code.capture };
  const allowFile = capture.title_allowlist;

  const journal: Partial<Record<Period, PeriodicSetting>> = {};
  for (const period of PERIODS) {
    const configured = code.journal?.[period] ?? file.journal?.[period];
    const source = code.journal?.[period] ? "options" : CONFIG_FILE;
    if (configured?.format) journal[period] = { folder: configured.folder ?? "", format: configured.format, source };
  }
  const template = templates(file, code);

  return {
    capture: {
      folder: capture.folder ?? "",
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
    ...(template ? { templates: template } : {}),
  };
}

/** `[templates]` in code options or `tsuzuri.toml`; no folder is assumed. */
function templates(file: TsuzuriConfig, code: TsuzuriConfig): TemplateSettings | undefined {
  const folder = code.templates?.folder ?? file.templates?.folder;
  if (folder === undefined || folder.trim() === "") return undefined;
  return {
    folder: folder.replace(/^\/+|\/+$/g, ""),
    // Obsidian's own defaults for a template's {{date}} and {{time}}.
    dateFormat: code.templates?.date_format ?? file.templates?.date_format ?? "YYYY-MM-DD",
    timeFormat: code.templates?.time_format ?? file.templates?.time_format ?? "HH:mm",
    source: code.templates?.folder ? "options" : CONFIG_FILE,
  };
}
