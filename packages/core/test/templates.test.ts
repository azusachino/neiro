import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type NeiroConfig,
  NotFoundError,
  renderTemplate,
  resolveSettings,
  splitFrontmatter,
  templateFor,
  UnsupportedError,
  Vault,
} from "../src/index.ts";
import { copyVault, FIXTURE } from "./git.ts";

const NOW = new Date(2026, 8, 24, 19, 5);
const _CLI = join(import.meta.dir, "..", "src", "cli.ts");
const KEPANO = join(import.meta.dir, "vaults", "kepano-obsidian");
const kepanoPresent = existsSync(KEPANO) && readdirSync(KEPANO).length > 0;
const SETTINGS = { folder: "Templates", dateFormat: "YYYY-MM-DD", timeFormat: "HH:mm", source: "Templates" };

describe("template settings", () => {
  test("come from Obsidian's Templates setting, or neiro.toml, and nothing is assumed", () => {
    expect(resolveSettings(FIXTURE).templates).toEqual(SETTINGS);
    const config: NeiroConfig = { templates: { folder: "Notes", date_format: "DD.MM.YYYY" } };
    expect(resolveSettings(FIXTURE, config).templates).toMatchObject({
      folder: "Notes",
      dateFormat: "DD.MM.YYYY",
      source: "options",
    });
    const bare = copyVault();
    writeFileSync(join(bare, ".obsidian", "templates.json"), "{}");
    expect(resolveSettings(bare).templates).toBeUndefined();
  });
});

describe("rendering", () => {
  test("fills title, date, and time, with an optional moment-style format", () => {
    const text = "{{title}} {{date}} {{time}} {{date:YYYY}} {{ date:DD.MM }} {{time:HH}}";
    expect(renderTemplate(text, "Dune", NOW, SETTINGS)).toBe("Dune 2026-09-24 19:05 2026 24.09 19");
  });

  test("leaves other template syntaxes as written", () => {
    expect(renderTemplate("<% tp.date.now() %> {{other}}", "x", NOW, SETTINGS)).toBe("<% tp.date.now() %> {{other}}");
  });

  test("finds a template named after the type, with or without Template", () => {
    const paths = ["Templates/Book.md", "Templates/Movie Template.md", "Notes/Book.md"];
    expect(templateFor(paths, "Templates", "book")).toBe("Templates/Book.md");
    expect(templateFor(paths, "Templates", "Movie")).toBe("Templates/Movie Template.md");
    expect(templateFor(paths, "Templates", "song")).toBeUndefined();
  });
});

describe("new", () => {
  test("creates a note from the fixture's template, placed and checked as capture does", async () => {
    const root = copyVault();
    const vault = new Vault(root);
    const result = await vault.create("book", "Dune", { now: NOW });
    expect(result.path).toBe("Inbox/Dune.md");
    const { data, body } = splitFrontmatter(readFileSync(join(root, result.path), "utf8"));
    expect(data).toMatchObject({ type: "book", year: "2026", tags: ["reading"], author: null, rating: null });
    expect(body).toContain("# Dune");
    expect(body).toContain("Started 2026-09-24 at 19:05.");
    expect((await vault.find("Dune")).path).toBe("Inbox/Dune.md");
  });

  test("applies the vault's capture rules, and adds tags", async () => {
    const vault = new Vault(copyVault(), {
      config: { capture: { folder: "queue", filename: "slug", tag_style: "kebab", properties: ["title", "tags"] } },
    });
    const result = await vault.create("book", "The Left Hand of Darkness", { now: NOW, tags: ["Science Fiction"] });
    expect(result.path).toBe("queue/the-left-hand-of-darkness.md");
    expect(splitFrontmatter(result.content).data).toMatchObject({
      title: "The Left Hand of Darkness",
      tags: ["reading", "science-fiction"],
    });
  });

  test("names the templates that exist when the type has none, and needs a template folder", async () => {
    expect(new Vault(copyVault()).create("song", "x")).rejects.toThrow("there are: Book");
    expect(new Vault(copyVault()).create("song", "x")).rejects.toThrow(NotFoundError);
    const bare = copyVault();
    writeFileSync(join(bare, ".obsidian", "templates.json"), "{}");
    expect(new Vault(bare).create("book", "x")).rejects.toThrow(UnsupportedError);
  });
});

describe.skipIf(!kepanoPresent)("kepano-obsidian templates", () => {
  test("a book renders with valid frontmatter, its properties, blanks, and tags kept", async () => {
    const result = await new Vault(KEPANO).create("book", "Dune", { now: NOW, dryRun: true });
    const { data } = splitFrontmatter(result.content);
    expect(result.written).toBe(false);
    expect(data).toMatchObject({ categories: ["[[Books]]"], created: "2026-09-24", tags: ["to-read"], cover: null });
  });

  test("every template renders to parseable frontmatter", async () => {
    const vault = new Vault(KEPANO);
    const types = readdirSync(join(KEPANO, "Templates"))
      .filter((name) => name.endsWith(" Template.md"))
      .map((name) => name.replace(/ Template\.md$/, ""));
    expect(types.length).toBeGreaterThan(10);
    for (const type of types) {
      const { content } = await vault.create(type, `A ${type}`, { now: NOW, dryRun: true });
      if (content.startsWith("---\n")) expect(Object.keys(splitFrontmatter(content).data).length).toBeGreaterThan(0);
      expect(content).not.toContain("{{date");
    }
  });
});
