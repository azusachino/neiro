import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { countTags, noteTags, tagMatches, Vault } from "../src/index.ts";
import { FIXTURE } from "./vault.test.ts";

const vault = new Vault(FIXTURE);
const CLI = join(import.meta.dir, "..", "src", "cli.ts");

describe("reading tags", () => {
  test("reads a list, a comma- or space-separated string, and # prefixes", () => {
    expect(noteTags(["a", "#b", "  c "])).toEqual(["a", "b", "c"]);
    expect(noteTags("#History, overview")).toEqual(["History", "overview"]);
    expect(noteTags("one two,three")).toEqual(["one", "two", "three"]);
    expect(noteTags(undefined)).toEqual([]);
    expect(noteTags(["a", "a", 3, null])).toEqual(["a"]);
  });

  test("normalizes each fixture tag form", async () => {
    expect((await vault.find("History/Overview.md")).tags).toEqual(["History", "overview"]);
    expect((await vault.find("Topics/History/Timeline.md")).tags).toEqual(["history/timeline", "overview"]);
  });
});

describe("matching tags", () => {
  test("is case-insensitive and lets a parent match its nested tags", () => {
    expect(tagMatches(["History"], "history")).toBe(true);
    expect(tagMatches(["history/timeline"], "History")).toBe(true);
    expect(tagMatches(["history/timeline"], "#history/timeline")).toBe(true);
    expect(tagMatches(["historical"], "history")).toBe(false);
    expect(tagMatches(["history"], "history/timeline")).toBe(false);
  });

  test("requires every tag in a filter", async () => {
    const paths = async (tags: string[]) => (await vault.list({ tags })).map((note) => note.path);
    expect(await paths(["history"])).toEqual(["History/Overview.md", "Topics/History/Timeline.md"]);
    expect(await paths(["history", "overview"])).toEqual(["History/Overview.md", "Topics/History/Timeline.md"]);
    expect(await paths(["history/timeline", "OVERVIEW"])).toEqual(["Topics/History/Timeline.md"]);
    expect(await paths(["history", "tea"])).toEqual([]);
  });
});

describe("counting tags", () => {
  test("counts notes per tag, parents of nested tags included, case variants merged", () => {
    const counts = countTags([{ tags: ["Area/sub", "x"] }, { tags: ["area", "area/other"] }, { tags: ["AREA/sub"] }]);
    expect(counts).toEqual([
      { tag: "Area", notes: 3 },
      { tag: "Area/sub", notes: 2 },
      { tag: "area/other", notes: 1 },
      { tag: "x", notes: 1 },
    ]);
  });

  test("lists the fixture's tags with counts, narrowed by the filters", async () => {
    expect(await vault.tags()).toContainEqual({ tag: "History", notes: 2 });
    expect(await vault.tags()).toContainEqual({ tag: "psychology", notes: 2 });
    expect(await vault.tags({ under: "People" })).toEqual([{ tag: "philosophy", notes: 2 }]);
  });

  test("prints counts from the CLI, and --tag may repeat", () => {
    const run = (...args: string[]) => spawnSync("bun", [CLI, "--vault", FIXTURE, ...args], { encoding: "utf8" });
    expect(JSON.parse(run("tags", "--under", "People", "--json").stdout)).toEqual([{ tag: "philosophy", notes: 2 }]);
    expect(run("tags", "--under", "Notes").stdout).toBe("1\ttea\n");
    expect(run("list", "--tag", "history", "--tag", "overview", "--format", "paths").stdout.trim().split("\n")).toEqual(
      ["History/Overview.md", "Topics/History/Timeline.md"],
    );
    expect(run("tags", "extra").status).toBe(2);
  });
});
