import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { NotFoundError, parseDate, UnsupportedError, Vault } from "../src/index.ts";

export const FIXTURE = join(import.meta.dir, "fixtures", "vault");
const vault = new Vault(FIXTURE);

describe("scanning", () => {
  test("skips dot folders and submodule paths", async () => {
    const paths = (await vault.notes()).map((note) => note.path);
    expect(paths).toContain("Topics/Cognitive load.md");
    expect(paths.some((path) => path.startsWith(".trash/") || path.startsWith("libs/"))).toBe(false);
  });

  test("uses the file name as the title when there is no title property", async () => {
    expect((await vault.find("Home")).title).toBe("Home");
    expect((await vault.find("乌龙茶")).path).toBe("Notes/乌龙茶.md");
  });

  test("rejects a missing vault", () => {
    expect(() => new Vault(join(FIXTURE, "nowhere"))).toThrow(NotFoundError);
  });
});

describe("find and get", () => {
  test("resolves a path, stem, title, or alias", async () => {
    for (const ref of ["Topics/Cognitive load.md", "Topics/Cognitive load", "cognitive load", "clt"]) {
      expect((await vault.find(ref)).path).toBe("Topics/Cognitive load.md");
    }
  });

  test("refuses an ambiguous stem and names the candidates", async () => {
    expect(vault.find("Plato")).rejects.toThrow("People/Greek/Plato.md, People/Plato.md");
  });

  test("returns a content hash and marks truncation", async () => {
    const full = await vault.get("Working memory");
    const cut = await vault.get("Working memory", { maxChars: 10 });
    expect(full.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(full.truncated).toBe(false);
    expect(cut.body).toHaveLength(10);
    expect(cut.truncated).toBe(true);
    expect(cut.hash).toBe(full.hash);
  });
});

describe("list", () => {
  test("filters by property, tag, and folder", async () => {
    expect((await vault.list({ type: "person" })).map((note) => note.path)).toEqual([
      "People/Greek/Plato.md",
      "People/Plato.md",
    ]);
    expect((await vault.list({ tag: "psychology/memory", under: "Topics" })).length).toBe(2);
    expect((await vault.list({ status: "draft" })).map((note) => note.path)).toEqual(["Inbox/Existing idea.md"]);
  });
});

describe("links", () => {
  test("resolves each wikilink form the way Obsidian does", async () => {
    const byTarget = Object.fromEntries(
      (await vault.links("Cognitive load")).map((link) => [link.target, link.resolution]),
    );
    expect(byTarget["Topics/Working memory"]).toEqual({ status: "resolved", path: "Topics/Working memory.md" });
    expect(byTarget["Working memory"]).toEqual({ status: "resolved", path: "Topics/Working memory.md" });
    expect(byTarget.index).toEqual({ status: "resolved", path: "Topics/index.md" });
    expect(byTarget["History/Timeline"]).toEqual({ status: "resolved", path: "Topics/History/Timeline.md" });
    expect(byTarget["History/Overview"]).toEqual({ status: "resolved", path: "History/Overview.md" });
    expect(byTarget.Plato).toEqual({ status: "ambiguous", candidates: ["People/Greek/Plato.md", "People/Plato.md"] });
    expect(byTarget["Missing note"]).toEqual({ status: "missing" });
    expect(byTarget["diagram.png"]).toEqual({ status: "asset" });
  });

  test("skips code, strips heading targets, and reads escaped table pipes", async () => {
    const links = await vault.links("Cognitive load");
    expect(links.map((link) => link.target)).not.toContain("in-code");
    expect(links.map((link) => link.target)).not.toContain("fenced");
    expect(links.find((link) => link.display === "capacity")?.target).toBe("Working memory");
    expect(links.filter((link) => link.display === "wm")).toHaveLength(2);
  });

  test("finds backlinks and unresolved links", async () => {
    expect((await vault.backlinks("Cognitive load")).map((note) => note.path)).toEqual(["Home.md", "Topics/index.md"]);
    const unresolved = (await vault.unresolved()).map(({ target, resolution }) => `${target}:${resolution.status}`);
    expect(unresolved).toEqual(["Plato:ambiguous", "Missing note:missing"]);
  });
});

describe("nav", () => {
  test("shows the root folders and notes", async () => {
    const root = await vault.nav();
    expect(root.index).toBeUndefined();
    expect(root.folders.map((folder) => folder.path)).toEqual([
      "Daily",
      "History",
      "Inbox",
      "Notes",
      "People",
      "Topics",
      "Weekly",
    ]);
    expect(root.notes).toEqual([{ path: "Home.md", title: "Home" }]);
  });

  test("shows a folder's index note and headings", async () => {
    const topics = await vault.nav("Topics/");
    expect(topics.folder).toBe("Topics");
    expect(topics.index).toEqual({ path: "Topics/index.md", title: "index", headings: ["reading order"] });
    expect(topics.folders).toEqual([{ path: "Topics/History", title: "History", notes: 1 }]);
    expect(topics.notes.map((note) => note.path)).toEqual(["Topics/Cognitive load.md", "Topics/Working memory.md"]);
  });
});

describe("search", () => {
  test("ranks a title match first", async () => {
    const hits = await vault.search("cognitive load");
    expect(hits[0]?.path).toBe("Topics/Cognitive load.md");
    expect(hits.map((hit) => hit.path)).toContain("Topics/Working memory.md");
  });

  test("matches CJK text as a substring", async () => {
    const hits = await vault.search("乌龙茶");
    expect(hits.map((hit) => hit.path)).toEqual(["Notes/乌龙茶.md"]);
    expect(hits[0]?.snippet).toContain("乌龙茶");
  });

  test("matches Latin words on word boundaries and honours filters", async () => {
    expect(await vault.search("cogn")).toEqual([]);
    expect((await vault.search("load", { under: "People" })).map((hit) => hit.path)).toEqual([]);
    expect(await vault.search("   ")).toEqual([]);
  });
});

describe("journal", () => {
  test("reads Obsidian's Daily Notes and Periodic Notes settings", async () => {
    expect((await vault.journalFor("day", parseDate("2026-09-16"))).note?.path).toBe("Daily/2026-09-16.md");
    expect((await vault.journalFor("week", parseDate("2026-09-16"))).note?.path).toBe("Weekly/2026-W38.md");
    expect(await vault.journalFor("day", parseDate("2026-09-17"))).toEqual({ path: "Daily/2026-09-17.md", note: null });
  });

  test("raises UnsupportedError for a period no setting covers", async () => {
    expect(vault.journalFor("month", parseDate("2026-09-16"))).rejects.toThrow(UnsupportedError);
    expect(new Vault(join(FIXTURE, "People")).journalFor("day")).rejects.toThrow("no day journal settings");
  });

  test("lets code options override the vault's settings", async () => {
    const configured = new Vault(FIXTURE, {
      config: { journal: { week: { folder: "log", format: "GGGG/[weekly]/GGGG-[w]WW" } } },
    });
    expect((await configured.journalFor("week", parseDate("2021-01-01"))).path).toBe("log/2020/weekly/2020-w53.md");
    expect((await configured.journalFor("day", parseDate("2021-01-01"))).path).toBe("Daily/2021-01-01.md");
  });
});
