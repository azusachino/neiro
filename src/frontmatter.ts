import { parseYaml } from "./providers.ts";

export type Frontmatter = Record<string, unknown>;

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** A property value written as text, read as YAML reads it: `4` is a number, `[a, b]` a list, other text stays text. */
export function propertyValue(text: string): unknown {
  try {
    return parseYaml.get()(text) ?? text;
  } catch {
    return text;
  }
}

/** Where the YAML between a note's `---` fences sits, as character offsets, or undefined without frontmatter. */
export function frontmatterRange(raw: string): { start: number; end: number } | undefined {
  const match = FENCE.exec(raw);
  if (!match) return undefined;
  const start = raw.startsWith("---\r\n") ? 5 : 4;
  return { start, end: start + (match[1] ?? "").length };
}

/** Split a note into its YAML frontmatter and body. Malformed YAML yields an empty object, never a throw. */
export function splitFrontmatter(raw: string): { data: Frontmatter; body: string } {
  const match = FENCE.exec(raw);
  if (!match) return { data: {}, body: raw };
  let data: unknown;
  try {
    data = parseYaml.get()(match[1] ?? "");
  } catch {
    data = null;
  }
  const isObject = typeof data === "object" && data !== null && !Array.isArray(data);
  return { data: isObject ? (data as Frontmatter) : {}, body: raw.slice(match[0].length) };
}

/** The string entries of a frontmatter list field such as `tags` or `aliases`. */
export function stringList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

const NEEDS_QUOTES =
  /: |\s#|^[\s\-?:,[\]{}#&*!|>'"%@`]|\s$|^(?:true|false|null|yes|no|on|off|~)$|^(?!\d{4}-\d{2}-\d{2}$)[\d.+-]+$/i;

/** A YAML scalar, double-quoted only when plain style would change its meaning. An ISO date stays plain, as Obsidian writes a Date property. */
export function yamlScalar(value: string): string {
  return value === "" || NEEDS_QUOTES.test(value) ? JSON.stringify(value) : value;
}
