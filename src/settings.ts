import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigError } from "./errors.ts";
import { parseToml } from "./providers.ts";

export const CONFIG_FILE = "tsuzuri.toml";

export { UnsupportedError } from "./chain.ts";

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
  /** Unset when no source names a template folder; `new` then raises `UnsupportedError`. */
  templates?: TemplateSettings;
  /** The extensions the settings list, as written: `tsuzuri:<name>` for a bundled one, else a vault-relative module. */
  extensions: string[];
  /** The tables the loaded extensions read, as written, with code options' tables over the file's. */
  tables: Record<string, Record<string, unknown>>;
}

/** Which extension tables a `Vault` accepts: those its loaded extensions read, and any at all when one was skipped. */
export interface TableClaims {
  tables: ReadonlySet<string>;
  skipped: boolean;
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
  templates?: { folder?: string; date_format?: string; time_format?: string };
  /** Extensions to load: `tsuzuri:<name>` for a bundled one, or a module path relative to the vault root. */
  extensions?: string[];
  /** An extension's own table, such as `[journal]`, accepted when that extension is loaded. */
  [table: string]: unknown;
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
function checkConfig(config: unknown, source: string, claims: TableClaims): TsuzuriConfig {
  if (!isTable(config)) throw new ConfigError(`${source}: settings must be a table`);
  for (const [section, value] of Object.entries(config)) {
    if (section === "extensions") {
      if (!fits(value, "strings")) throw new ConfigError(`${source}: extensions must be a list of strings`);
      continue;
    }
    const rules = RULES[section];
    if (rules) {
      checkTable(value, rules, section, source);
      continue;
    }
    if (claims.tables.has(section)) {
      if (!isTable(value)) throw new ConfigError(`${source}: ${section} must be a table`);
      continue;
    }
    // A table may belong to an extension that was listed but not loaded; that extension checks it once it loads.
    if (claims.skipped) continue;
    if (section === "journal") {
      throw new ConfigError(
        `${source}: [journal] needs the journal extension: add extensions = ["tsuzuri:journal"] (ADR 0020)`,
      );
    }
    throw new ConfigError(`${source}: unknown key ${section}; settings take capture, templates, extensions`);
  }
  return config as TsuzuriConfig;
}

/** The extensions `tsuzuri.toml` and code options list, the file's first, before any are loaded. */
export function listedExtensions(root: string, code: TsuzuriConfig = {}): string[] {
  const file = existsSync(join(root, CONFIG_FILE)) ? readToml(root, CONFIG_FILE) : {};
  const listed = [...((file as TsuzuriConfig).extensions ?? []), ...(code.extensions ?? [])];
  if (!fits(listed, "strings")) throw new ConfigError(`${CONFIG_FILE}: extensions must be a list of strings`);
  return [...new Set(listed)];
}

/**
 * Resolve settings by precedence: options passed in code, then `tsuzuri.toml`, then neutral defaults (ADR 0011).
 * An extension's table is accepted only when a loaded extension reads it (ADR 0019).
 */
export function resolveSettings(
  root: string,
  code: TsuzuriConfig = {},
  claims: TableClaims = { tables: new Set(), skipped: false },
): VaultSettings {
  const file = existsSync(join(root, CONFIG_FILE)) ? checkConfig(readToml(root, CONFIG_FILE), CONFIG_FILE, claims) : {};
  checkConfig(code, "options", claims);
  const tables: Record<string, Record<string, unknown>> = {};
  for (const table of claims.tables) {
    const value = code[table] ?? file[table];
    if (isTable(value)) tables[table] = value;
  }
  const capture = { ...file.capture, ...code.capture };
  const allowFile = capture.title_allowlist;
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
    ...(template ? { templates: template } : {}),
    extensions: listedExtensions(root, code),
    tables,
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
