import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "../src/index.ts";
import { copyVault, git, gitVault } from "./git.ts";

const NOTE = "Topics/Working memory.md";

describe("the watch policy", () => {
  test("a live vault sees a changed and a new file on its next read", async () => {
    const root = copyVault();
    const vault = new Vault(root, { watch: 0 });
    expect((await vault.get(NOTE)).body).toContain("a few items");
    writeFileSync(join(root, NOTE), "Working memory, rewritten while the vault was live.\n");
    writeFileSync(join(root, "Notes", "Arrived.md"), "A note that arrived later.\n");
    expect((await vault.get(NOTE)).body).toBe("Working memory, rewritten while the vault was live.\n");
    expect((await vault.find("Arrived")).path).toBe("Notes/Arrived.md");
  });

  test("without watch, the scan is kept until reload", async () => {
    const root = copyVault();
    const vault = new Vault(root);
    await vault.notes();
    writeFileSync(join(root, "Notes", "Unseen.md"), "not yet\n");
    expect(vault.find("Unseen")).rejects.toThrow();
    vault.reload();
    expect((await vault.find("Unseen")).path).toBe("Notes/Unseen.md");
  });

  test("checks at most once per interval, so reads in between do not rescan", async () => {
    const root = copyVault();
    const vault = new Vault(root, { watch: 60_000 });
    await vault.notes();
    writeFileSync(join(root, "Notes", "Later.md"), "later\n");
    expect((await vault.notes()).some((note) => note.path === "Notes/Later.md")).toBe(false);
  });
});

describe("sync", () => {
  test("pulls another clone's note and reloads", async () => {
    const { root, remote } = gitVault();
    const vault = new Vault(root);
    await vault.notes();

    const other = mkdtempSync(join(tmpdir(), "neiro-other-"));
    git(other, "clone", "--quiet", remote, ".");
    writeFileSync(join(other, "Notes", "From elsewhere.md"), "Written on another machine.\n");
    git(other, "add", ".");
    git(other, "-c", "user.name=other", "-c", "user.email=other@example.com", "commit", "--quiet", "-m", "add");
    git(other, "push", "--quiet");

    vault.sync();
    expect((await vault.find("From elsewhere")).path).toBe("Notes/From elsewhere.md");
  });
});
