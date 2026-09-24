/** Obsidian's core Templates: find a template by type and fill its `{{title}}`, `{{date}}`, and `{{time}}`. */
import { posix } from "node:path";
import { formatDate } from "./dateformat.ts";
import type { TemplateSettings } from "./settings.ts";

const PLACEHOLDER = /\{\{\s*(title|date|time)(?::([^}]*?))?\s*\}\}/gi;

/** The template for a type: a note in the template folder named `<type>` or `<type> Template`, in any case. */
export function templateFor(paths: string[], folder: string, type: string): string | undefined {
  const prefix = `${folder}/`;
  const wanted = type.trim().toLowerCase();
  return paths.find((path) => {
    if (!path.startsWith(prefix)) return false;
    const stem = posix.basename(path, ".md").toLowerCase();
    return stem === wanted || stem === `${wanted} template`;
  });
}

/** The template names available in the folder, for an error that says what exists. */
export function templateNames(paths: string[], folder: string): string[] {
  return paths
    .filter((path) => path.startsWith(`${folder}/`) && !path.slice(folder.length + 1).includes("/"))
    .map((path) => posix.basename(path, ".md").replace(/ template$/i, ""));
}

/**
 * Fill the placeholders Obsidian's core Templates plugin knows: `{{title}}`, and `{{date}}` and `{{time}}` with an
 * optional moment-style format such as `{{date:YYYY-MM-DD}}`. Other syntaxes (Templater, Foam) are left as written.
 */
export function renderTemplate(text: string, title: string, now: Date, settings: TemplateSettings): string {
  return text.replace(PLACEHOLDER, (_, name: string, format: string | undefined) => {
    const kind = name.toLowerCase();
    if (kind === "title") return title;
    const fallback = kind === "date" ? settings.dateFormat : settings.timeFormat;
    return formatDate(now, format?.trim() || fallback);
  });
}
