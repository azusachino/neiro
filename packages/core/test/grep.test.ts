import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { grepPattern } from "../src/grep.ts";
import { formatGrep, Vault } from "../src/index.ts";
import { FIXTURE } from "./vault.test.ts";

const vault = new Vault(FIXTURE);
const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const hasRipgrep = spawnSync("rg", ["--version"]).status === 0;

/** ripgrep over the fixture with neiro's exclusions: dot folders are hidden by default, submodule paths excluded. */
function ripgrep(...args: string[]): string {
  const result = spawnSync("rg", ["-n", "-S", "--sort", "path", "--glob", "*.md", "--glob", "!libs", ...args, "."], {
    cwd: FIXTURE,
    encoding: "utf8",
  });
  return result.stdout.replaceAll("./", "").trimEnd();
}

function neiro(...args: string[]): string {
  return spawnSync("bun", [CLI, "--vault", FIXTURE, "grep", ...args], { encoding: "utf8" }).stdout.trimEnd();
}

describe("grep", () => {
  test("numbers lines from the top of the file, frontmatter included", async () => {
    const hits = await vault.grep("psychology/memory");
    expect(hits.map(({ path, line }) => `${path}:${line}`)).toEqual([
      "Topics/Cognitive load.md:6",
      "Topics/Working memory.md:3",
    ]);
  });

  test("uses smart case, ignoring escapes", () => {
    expect(grepPattern("memory").flags).toContain("i");
    expect(grepPattern("Memory").flags).not.toContain("i");
    expect(grepPattern("\\Smemory").flags).toContain("i");
    expect(grepPattern("A.", { fixed: true }).flags).not.toContain("i");
  });

  test("matches literal text with fixed, and regular expressions otherwise", async () => {
    expect(await vault.grep("[[index]]", { fixed: true })).toHaveLength(1);
    expect((await vault.grep("^- Folder")).map((hit) => hit.line)).toEqual([12]);
    expect(() => grepPattern("(")).toThrow(SyntaxError);
  });

  test("honours the note filters", async () => {
    const paths = new Set((await vault.grep("type: person", { under: "People/Greek" })).map((hit) => hit.path));
    expect([...paths]).toEqual(["People/Greek/Plato.md"]);
    expect(await vault.grep("type: person", { type: "no-such-type" })).toEqual([]);
  });

  test("attaches context lines, leaving other matches as matches", async () => {
    const [hit] = await vault.grep("^Cognitive load theory", { context: 1 });
    expect(hit?.before).toEqual([{ line: 8, text: "" }]);
    expect(hit?.after).toEqual([{ line: 10, text: "" }]);
    const both = await vault.grep("memory\\]\\]", { context: 2 });
    expect(both.flatMap((h) => [...(h.before ?? []), ...(h.after ?? [])]).some((l) => l.line === both[1]?.line)).toBe(
      false,
    );
  });

  test("prints matches and context in ripgrep's layout", () => {
    const text = formatGrep([
      { path: "a.md", line: 2, text: "hit", before: [{ line: 1, text: "b" }], after: [{ line: 3, text: "c" }] },
      { path: "a.md", line: 9, text: "hit", before: [], after: [] },
    ]);
    expect(text).toBe("a.md-1-b\na.md:2:hit\na.md-3-c\n--\na.md:9:hit");
    expect(formatGrep([{ path: "a.md", line: 2, text: "x" }])).toBe("a.md:2:x");
  });
});

describe.skipIf(!hasRipgrep)("grep against ripgrep", () => {
  for (const args of [["working memory"], ["Working"], ["-F", "[[Plato]]"], ["-C", "1", "-F", "Plato"], ["^tags:"]]) {
    test(`matches rg -n ${args.join(" ")}`, () => {
      expect(neiro(...args)).toBe(ripgrep(...args));
    });
  }
});

describe("cli grep", () => {
  test("prints unique paths with --format paths and exits 2 for a bad pattern", () => {
    expect(neiro("memory", "--format", "paths").split("\n")).toEqual([
      "Topics/Cognitive load.md",
      "Topics/Working memory.md",
    ]);
    expect(spawnSync("bun", [CLI, "--vault", FIXTURE, "grep", "("]).status).toBe(2);
  });
});
