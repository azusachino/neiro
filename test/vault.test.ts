import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isoWeek, journalPath, NotFoundError, parseDate, Vault } from "../src/index.ts";

export const FIXTURE = join(import.meta.dir, "fixtures", "vault");
const vault = new Vault(FIXTURE);

describe("scanning", () => {
  test("skips dot folders and submodule paths", async () => {
    const paths = (await vault.notes()).map((note) => note.path);
    expect(paths).toContain("note/tech/cognitive-load.md");
    expect(paths.some((path) => path.startsWith(".foam/") || path.startsWith("vendor/"))).toBe(false);
  });

  test("rejects a missing vault", () => {
    expect(() => new Vault(join(FIXTURE, "nowhere"))).toThrow(NotFoundError);
  });
});

describe("find and get", () => {
  test("resolves a path, stem, title, or alias", async () => {
    for (const ref of [
      "note/tech/cognitive-load.md",
      "note/tech/cognitive-load",
      "cognitive-load",
      "Cognitive Load Theory",
      "clt",
    ]) {
      expect((await vault.find(ref)).path).toBe("note/tech/cognitive-load.md");
    }
  });

  test("refuses an ambiguous stem and names the candidates", async () => {
    expect(vault.find("plato")).rejects.toThrow("note/people/greek/plato.md, note/people/plato.md");
  });

  test("returns a content hash and marks truncation", async () => {
    const full = await vault.get("working-memory");
    const cut = await vault.get("working-memory", { maxChars: 10 });
    expect(full.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(full.truncated).toBe(false);
    expect(cut.body).toHaveLength(10);
    expect(cut.truncated).toBe(true);
    expect(cut.hash).toBe(full.hash);
  });
});

describe("list", () => {
  test("filters by type, tag, status, and folder", async () => {
    expect((await vault.list({ type: "person" })).map((note) => note.path)).toEqual([
      "note/people/greek/plato.md",
      "note/people/plato.md",
    ]);
    expect((await vault.list({ tag: "psychology", under: "note/tech" })).length).toBe(2);
    expect((await vault.list({ status: "inbox" })).map((note) => note.path)).toEqual(["inbox/existing-idea.md"]);
  });
});

describe("links", () => {
  test("resolves each wikilink form the way Obsidian does", async () => {
    const byTarget = Object.fromEntries(
      (await vault.links("cognitive-load")).map((link) => [link.target, link.resolution]),
    );
    expect(byTarget["note/tech/working-memory"]).toEqual({ status: "resolved", path: "note/tech/working-memory.md" });
    expect(byTarget["working-memory"]).toEqual({ status: "resolved", path: "note/tech/working-memory.md" });
    expect(byTarget.index).toEqual({ status: "resolved", path: "note/tech/index.md" });
    expect(byTarget["history/index"]).toEqual({ status: "resolved", path: "note/tech/history/index.md" });
    expect(byTarget.plato).toEqual({
      status: "ambiguous",
      candidates: ["note/people/greek/plato.md", "note/people/plato.md"],
    });
    expect(byTarget["missing-note"]).toEqual({ status: "missing" });
    expect(byTarget["diagram.png"]).toEqual({ status: "asset" });
  });

  test("skips code, strips heading targets, and reads escaped table pipes", async () => {
    const links = await vault.links("cognitive-load");
    expect(links.map((link) => link.target)).not.toContain("in-code");
    expect(links.map((link) => link.target)).not.toContain("fenced");
    expect(links.find((link) => link.display === "capacity")?.target).toBe("working-memory");
    expect(links.filter((link) => link.display === "wm")).toHaveLength(2);
  });

  test("finds backlinks and unresolved links", async () => {
    expect((await vault.backlinks("cognitive-load")).map((note) => note.path)).toEqual([
      "maps/tech-map.md",
      "note/tech/index.md",
    ]);
    const unresolved = (await vault.unresolved()).map(({ target, resolution }) => `${target}:${resolution.status}`);
    expect(unresolved).toEqual(["plato:ambiguous", "missing-note:missing"]);
  });
});

describe("nav", () => {
  test("shows the root index, folders, and direct notes", async () => {
    const root = await vault.nav();
    expect(root.index).toEqual({ path: "index.md", title: "home", headings: ["start here", "current flow"] });
    expect(root.folders.map((folder) => folder.path)).toEqual(["inbox", "journal", "maps", "note"]);
    expect(root.folders.find((folder) => folder.path === "note")?.title).toBe("notes");
    expect(root.notes).toEqual([]);
  });

  test("shows one folder", async () => {
    const tech = await vault.nav("note/tech/");
    expect(tech.folder).toBe("note/tech");
    expect(tech.index?.title).toBe("tech");
    expect(tech.folders).toEqual([{ path: "note/tech/history", title: "tech history", notes: 1 }]);
    expect(tech.notes.map((note) => note.path)).toEqual(["note/tech/cognitive-load.md", "note/tech/working-memory.md"]);
  });
});

describe("search", () => {
  test("ranks a title match first", async () => {
    const hits = await vault.search("cognitive load");
    expect(hits[0]?.path).toBe("note/tech/cognitive-load.md");
    expect(hits.map((hit) => hit.path)).toContain("note/tech/working-memory.md");
  });

  test("matches CJK text as a substring", async () => {
    const hits = await vault.search("乌龙茶");
    expect(hits.map((hit) => hit.path)).toEqual(["note/life/tea.md"]);
    expect(hits[0]?.snippet).toContain("乌龙茶");
  });

  test("matches Latin words on word boundaries and honours filters", async () => {
    expect(await vault.search("cogn")).toEqual([]);
    expect((await vault.search("load", { under: "journal" })).map((hit) => hit.path)).toEqual([]);
    expect(await vault.search("   ")).toEqual([]);
  });
});

describe("journal", () => {
  test("uses ISO weeks, including week 53", () => {
    expect(isoWeek(new Date(2026, 8, 16))).toEqual({ isoYear: 2026, week: 38 });
    expect(isoWeek(new Date(2021, 0, 1))).toEqual({ isoYear: 2020, week: 53 });
    expect(journalPath("week", new Date(2021, 0, 1))).toBe("journal/2020/weekly/2020-w53.md");
    expect(journalPath("month", new Date(2021, 0, 1))).toBe("journal/2021/monthly/2021-01.md");
  });

  test("returns the note, or the path it would have", async () => {
    expect((await vault.journalFor("week", parseDate("2026-09-16"))).note?.title).toBe("2026-w38");
    expect(await vault.journalFor("month", parseDate("2026-10-01"))).toEqual({
      path: "journal/2026/monthly/2026-10.md",
      note: null,
    });
  });

  test("rejects malformed dates", () => {
    expect(() => parseDate("2026-9-1")).toThrow();
    expect(() => parseDate("2026-02-30")).toThrow();
  });

  test("reads the journal layout from neiro.toml", async () => {
    const root = mkdtempSync(join(tmpdir(), "neiro-config-"));
    cpSync(FIXTURE, root, { recursive: true });
    writeFileSync(join(root, "neiro.toml"), '[journal]\nweek = "weeks/{isoYear}-{ww}.md"\n');
    const configured = new Vault(root);
    expect((await configured.journalFor("week", parseDate("2026-09-16"))).path).toBe("weeks/2026-38.md");
    expect((await configured.journalFor("month", parseDate("2026-09-16"))).path).toBe(
      "journal/2026/monthly/2026-09.md",
    );
  });
});
