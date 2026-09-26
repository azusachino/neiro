import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { propertyValue, Vault, WriteConflictError } from "tsuzuri";
import { copyVault } from "./git.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const COMMENTED = [
  "---",
  "# kept by the owner",
  "zeta: 1 # why zeta comes first",
  'title: "A quoted title"',
  "tags:",
  "  - a",
  "  - b",
  "alpha: [x, y]",
  "---",
  "",
  "Body stays.",
  "",
].join("\n");

function vaultWith(name: string, content: string): { vault: Vault; read: () => string; root: string } {
  const root = copyVault();
  writeFileSync(join(root, name), content);
  return { root, vault: new Vault(root), read: () => readFileSync(join(root, name), "utf8") };
}

describe("prop set", () => {
  test("keeps comments, key order, quoting, and every other line", async () => {
    const { vault, read } = vaultWith("Commented.md", COMMENTED);
    await vault.setProperty("Commented", "zeta", 2);
    await vault.setProperty("Commented", "rating", 4);
    expect(read()).toBe(
      COMMENTED.replace("zeta: 1 #", "zeta: 2 #").replace("alpha: [x, y]\n", "alpha: [x, y]\nrating: 4\n"),
    );
    expect((await vault.find("Commented")).frontmatter).toMatchObject({ zeta: 2, rating: 4, title: "A quoted title" });
  });

  test("fills an empty frontmatter block instead of adding a second one", async () => {
    const { vault, read } = vaultWith("Empty.md", "---\n---\nBody.\n\n---\n\nAfter a rule.\n");
    expect((await vault.find("Empty")).body).toBe("Body.\n\n---\n\nAfter a rule.\n");
    await vault.setProperty("Empty", "status", "draft");
    expect(read()).toBe("---\nstatus: draft\n---\nBody.\n\n---\n\nAfter a rule.\n");
    expect(await vault.outline("Empty")).toEqual([]);
  });

  test("adds a block to a note without frontmatter, leaving the body as it was", async () => {
    const { vault, read } = vaultWith("Plain.md", "Just text.\n");
    await vault.setProperty("Plain", "status", "draft");
    expect(read()).toBe("---\nstatus: draft\n---\nJust text.\n");
  });

  test("refuses frontmatter YAML cannot parse, and reads CLI values as YAML", async () => {
    const { vault } = vaultWith("Broken.md", "---\nkey: [unclosed\n---\nbody\n");
    await expect(vault.setProperty("Broken", "x", 1)).rejects.toThrow(WriteConflictError);
    expect(propertyValue("4")).toBe(4);
    expect(propertyValue("[a, b]")).toEqual(["a", "b"]);
    expect(propertyValue("true")).toBe(true);
    expect(propertyValue("plain words")).toBe("plain words");
    expect(propertyValue("2026-09-25")).toBe("2026-09-25");
  });

  test("works from the CLI, negative numbers included", () => {
    const { root, read } = vaultWith("Commented.md", COMMENTED);
    const run = (...args: string[]) => spawnSync("bun", [CLI, "--vault", root, ...args], { encoding: "utf8" });
    expect(run("prop", "set", "Commented", "born", "-428").status).toBe(0);
    expect(run("prop", "set", "Commented", "genre", "[sf, classic]").status).toBe(0);
    expect(read()).toContain("born: -428\ngenre:\n  - sf\n  - classic\n---");
    expect(run("prop", "set", "Commented", "x").status).toBe(2);
  });
});

describe("put", () => {
  test("creates a note, and replaces one only with the hash get returned", async () => {
    const root = copyVault();
    const vault = new Vault(root);
    const created = await vault.put("Notes/New note.md", "# New\n");
    expect(created).toMatchObject({ created: true, written: true });
    await expect(vault.put("Notes/New note.md", "silently replaced\n")).rejects.toThrow("needs --if-hash");
    const { hash } = await vault.get("Notes/New note.md");
    const replaced = await vault.put("Notes/New note.md", "# Replaced\n", { ifHash: hash });
    expect(replaced).toMatchObject({ created: false, written: true });
    await expect(vault.put("Notes/New note.md", "# Stale\n", { ifHash: hash })).rejects.toThrow(WriteConflictError);
    expect(readFileSync(join(root, "Notes", "New note.md"), "utf8")).toBe("# Replaced\n");
  });

  test("refuses paths outside the vault or not ending in .md", async () => {
    const vault = new Vault(copyVault());
    for (const path of ["../escape.md", "/abs.md", "Notes/x.txt", "Notes/../../out.md"]) {
      await expect(vault.put(path, "x")).rejects.toThrow(WriteConflictError);
    }
  });

  test("takes text, --file, or stdin from the CLI, and exits 1 when refused", () => {
    const root = copyVault();
    const run = (args: string[], input?: string) =>
      spawnSync("bun", [CLI, "--vault", root, ...args], { encoding: "utf8", input });
    expect(run(["put", "Notes/From stdin.md"], "piped\n").status).toBe(0);
    expect(readFileSync(join(root, "Notes", "From stdin.md"), "utf8")).toBe("piped\n");
    expect(run(["put", "Notes/From stdin.md", "again"]).status).toBe(1);
    expect(run(["put", "Notes/Dry.md", "x", "--dry-run"]).stdout).toContain("+x");
    expect(existsSync(join(root, "Notes", "Dry.md"))).toBe(false);
  });
});
