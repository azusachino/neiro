import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fuzzyRank, fuzzyScore, NotFoundError, Vault } from "../src/index.ts";
import { FIXTURE } from "./vault.test.ts";

const vault = new Vault(FIXTURE);
const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const score = (term: string, text: string) => fuzzyScore(term, text) ?? Number.NEGATIVE_INFINITY;

describe("fuzzy scoring", () => {
  test("matches characters in order and rejects anything else", () => {
    expect(fuzzyScore("cld", "Cognitive load")).not.toBeNull();
    expect(fuzzyScore("dlc", "Cognitive load")).toBeNull();
    expect(fuzzyScore("", "anything")).toBeNull();
  });

  test("rewards word starts, path separators, camelCase, and consecutive runs, as fzf does", () => {
    expect(score("cl", "cognitive load")).toBeGreaterThan(score("cl", "circle"));
    expect(score("t", "notes/topics")).toBeGreaterThan(score("t", "notes/at"));
    expect(score("wm", "WorkingMemory")).toBeGreaterThan(score("wm", "Workman"));
    expect(score("load", "cognitive load")).toBeGreaterThan(score("load", "l-o-a-d"));
  });

  test("uses smart case and folds full-width letters", () => {
    expect(fuzzyScore("plato", "Plato")).not.toBeNull();
    expect(fuzzyScore("Plato", "plato")).toBeNull();
    expect(fuzzyScore("ab", "ＡＢ")).not.toBeNull();
  });

  test("treats the first CJK character after other text as a word start", () => {
    expect(score("乌", "Notes/乌龙茶")).toBeGreaterThan(score("龙", "Notes/乌龙茶"));
    expect(fuzzyScore("乌龙", "乌龙茶")).not.toBeNull();
    expect(fuzzyScore("龙乌", "乌龙茶")).toBeNull();
  });

  test("requires every term, or any term with anyTerm", () => {
    const candidates = [{ item: "a", texts: ["cognitive load"] }];
    expect(fuzzyRank("cog load", candidates, 5)).toHaveLength(1);
    expect(fuzzyRank("cog laod", candidates, 5)).toHaveLength(0);
    expect(fuzzyRank("cog laod", candidates, 5, { anyTerm: true })).toHaveLength(1);
  });
});

describe("find", () => {
  test("ranks Latin titles, aliases, and paths", async () => {
    expect((await vault.suggest("cogld"))[0]?.path).toBe("Topics/Cognitive load.md");
    expect((await vault.suggest("wm"))[0]?.path).toBe("Topics/Working memory.md");
    expect((await vault.suggest("clt"))[0]).toMatchObject({ path: "Topics/Cognitive load.md", matched: "CLT" });
    expect((await vault.suggest("tpcs tmln"))[0]?.path).toBe("Topics/History/Timeline.md");
  });

  test("ranks CJK titles", async () => {
    expect((await vault.suggest("乌龙"))[0]?.path).toBe("Notes/乌龙茶.md");
    expect((await vault.suggest("茶"))[0]?.path).toBe("Notes/乌龙茶.md");
  });

  test("returns summaries narrowed by the filters and the limit", async () => {
    const hits = await vault.suggest("plato", { under: "People/Greek" });
    expect(hits.map((hit) => hit.path)).toEqual(["People/Greek/Plato.md"]);
    expect(hits[0]).toMatchObject({ title: "Plato", type: "person", tags: ["philosophy"] });
    expect(await vault.suggest("o", { limit: 2 })).toHaveLength(2);
  });
});

describe("a failed get", () => {
  test("suggests the closest notes, even through a typo", async () => {
    const error = await vault.find("cognitve laod").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as NotFoundError).suggestions[0]).toBe("Topics/Cognitive load.md");
    expect((error as NotFoundError).message).toContain("closest: Topics/Cognitive load.md");
  });

  test("says only not found when nothing is close", async () => {
    const error = (await vault.find("zzzzqq").catch((caught: unknown) => caught)) as NotFoundError;
    expect(error.suggestions).toEqual([]);
    expect(error.message).toBe('no note matches "zzzzqq"');
  });

  test("prints the suggestions from the CLI and exits 1", () => {
    const result = spawnSync("bun", [CLI, "--vault", FIXTURE, "get", "wrkng mem"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("closest: Topics/Working memory.md");
    const found = spawnSync("bun", [CLI, "--vault", FIXTURE, "find", "wrkng mem", "--json"], { encoding: "utf8" });
    expect(JSON.parse(found.stdout)[0]).toMatchObject({ path: "Topics/Working memory.md" });
  });
});
