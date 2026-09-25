/**
 * A note's sections by ATX heading, located by character offset so an edit can splice exactly one range. Headings
 * in the frontmatter and in fenced code blocks do not count.
 */

import { FRONTMATTER } from "./frontmatter.ts";

export interface HeadingAt {
  level: number;
  text: string;
  /** Counted from the top of the file, frontmatter included. */
  line: number;
  /** Offset of the heading line's first character. */
  start: number;
  /** Offset just past the heading line, including its line break. */
  bodyStart: number;
}

export interface Section {
  heading: HeadingAt;
  /** Offset of the next heading of the same or a higher level, or the end of the text. */
  end: number;
}

export class SectionError extends Error {}

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

export function headingsOf(text: string): HeadingAt[] {
  const headings: HeadingAt[] = [];
  const skip = FRONTMATTER.exec(text)?.[0].length ?? 0;
  let fence: string | undefined;
  let offset = 0;
  let line = 0;
  for (const raw of text.split(/(?<=\n)/)) {
    line++;
    const start = offset;
    offset += raw.length;
    if (start < skip) continue;
    const content = raw.replace(/\r?\n$/, "");
    const marker = FENCE.exec(content)?.[1];
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence ? undefined : marker;
      continue;
    }
    const match = fence ? null : HEADING.exec(content);
    if (match) {
      headings.push({ level: match[1]?.length ?? 1, text: match[2] as string, line, start, bodyStart: offset });
    }
  }
  return headings;
}

/** The section headed `name` (compared trimmed and case-insensitively), undefined when missing, an error when two are. */
export function findSection(text: string, name: string): Section | undefined {
  const headings = headingsOf(text);
  const wanted = name
    .trim()
    .replace(/^#+\s*/, "")
    .toLowerCase();
  const matches = headings.filter((heading) => heading.text.trim().toLowerCase() === wanted);
  if (matches.length > 1) {
    throw new SectionError(
      `"${name}" heads ${matches.length} sections, at lines ${matches.map((h) => h.line).join(", ")}`,
    );
  }
  const heading = matches[0];
  if (!heading) return undefined;
  const next = headings.find((other) => other.start > heading.start && other.level <= heading.level);
  return { heading, end: next?.start ?? text.length };
}

/** Where appended text goes: after the section's last non-blank character, keeping the blank lines before the next heading. */
export function sectionContentEnd(text: string, section: Section): number {
  const body = text.slice(section.heading.bodyStart, section.end);
  return section.heading.bodyStart + body.trimEnd().length;
}
