import { stringList } from "./frontmatter.ts";

export interface TagCount {
  /** The tag as first written in the vault, in path order; tags differing only in case are one tag. */
  tag: string;
  /** Notes carrying this tag or a tag nested under it. */
  notes: number;
}

/** The `tags` property as Obsidian reads it: a list, or one string of comma- or space-separated tags, `#` optional. */
export function noteTags(value: unknown): string[] {
  const written = typeof value === "string" ? value.split(/[,\s]+/) : stringList(value);
  const tags = written.map((tag) => tag.trim().replace(/^#/, "")).filter((tag) => tag !== "");
  return [...new Set(tags)];
}

/** Obsidian's tag matching: case-insensitive, and a nested tag `area/sub` matches `area`. */
export function tagMatches(tags: string[], wanted: string): boolean {
  const target = wanted.trim().replace(/^#/, "").toLowerCase();
  return tags.some((tag) => {
    const lower = tag.toLowerCase();
    return lower === target || lower.startsWith(`${target}/`);
  });
}

/** Each tag and every parent of a nested tag, with how many of the given notes carry it. */
export function countTags(notes: { tags: string[] }[]): TagCount[] {
  const counts = new Map<string, TagCount>();
  for (const note of notes) {
    const keys = new Map<string, string>();
    for (const tag of note.tags) {
      const parts = tag.split("/");
      parts.forEach((_, index) => {
        const prefix = parts.slice(0, index + 1).join("/");
        keys.set(prefix.toLowerCase(), prefix);
      });
    }
    for (const [key, spelling] of keys) {
      const entry = counts.get(key) ?? { tag: spelling, notes: 0 };
      entry.notes++;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.notes - a.notes || a.tag.localeCompare(b.tag));
}
