/** The steps of docs/container.md, run against a temporary bare remote standing in for the vault's repository. */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentTools, Vault, validateInput, WriteConflictError } from "../src/index.ts";
import { git, gitVault } from "./git.ts";

const BOT = "vault-bot <vault-bot@example.com>";

/** The owner's side: a clone that edits and pushes, as Obsidian with Git sync would. */
function ownerClone(remote: string): { dir: string; push: (path: string, text: string) => void } {
  const dir = mkdtempSync(join(tmpdir(), "neiro-owner-"));
  git(dir, "clone", "--quiet", remote, ".");
  git(dir, "config", "user.name", "owner");
  git(dir, "config", "user.email", "owner@example.com");
  return {
    dir,
    push: (path, text) => {
      git(dir, "pull", "--quiet", "--rebase");
      writeFileSync(join(dir, path), text);
      git(dir, "add", path);
      git(dir, "commit", "--quiet", "-m", `owner: edit ${path}`);
      git(dir, "push", "--quiet");
    },
  };
}

/** Step 3: the container's own clone, with the bot's identity. */
function botClone(remote: string): string {
  const dir = mkdtempSync(join(tmpdir(), "neiro-bot-"));
  git(dir, "clone", "--quiet", remote, ".");
  git(dir, "config", "user.name", "vault-bot");
  git(dir, "config", "user.email", "vault-bot@example.com");
  return dir;
}

describe("running against a Git clone", () => {
  test("pulls the owner's edits before reading, and pushes one commit per write", async () => {
    const { remote } = gitVault();
    const owner = ownerClone(remote);
    const vault = new Vault(botClone(remote), { watch: 5000 });
    await vault.notes();

    owner.push("Notes/From the owner.md", "Written in Obsidian.\n");
    await vault.sync();
    expect((await vault.find("From the owner")).path).toBe("Notes/From the owner.md");

    await vault.capture({ text: "Captured by the bot", tags: ["inbox"] }, { push: true, author: BOT });
    expect(git(remote, "log", "-1", "--format=%an|%s", "main")).toBe(
      "vault-bot|chore: capture Inbox/Captured by the bot.md",
    );
    expect(git(remote, "show", "--name-only", "--format=", "main")).toBe("Inbox/Captured by the bot.md");
  });

  test("captures while the owner pushes other edits, without conflict", async () => {
    const { remote } = gitVault();
    const owner = ownerClone(remote);
    const vault = new Vault(botClone(remote));
    owner.push("Home.md", "The owner rewrote the home note.\n");
    await vault.capture({ text: "A second capture" }, { push: true, author: BOT });
    git(owner.dir, "pull", "--quiet", "--rebase");
    expect(git(owner.dir, "log", "--format=%s", "-2").split("\n")).toEqual([
      "chore: capture Inbox/A second capture.md",
      "owner: edit Home.md",
    ]);
  });

  test("refuses a targeted write when the owner changed the note since it was read", async () => {
    const { remote } = gitVault();
    const owner = ownerClone(remote);
    const vault = new Vault(botClone(remote));
    const { hash } = await vault.get("Home");
    owner.push("Home.md", "The owner's newer text.\n");
    await vault.sync();
    await expect(vault.append("Home", "- from the bot", { ifHash: hash, commit: true })).rejects.toThrow(
      WriteConflictError,
    );
    const fresh = await vault.get("Home");
    await vault.append("Home", "- from the bot", { ifHash: fresh.hash, commit: true });
    await vault.sync();
    expect(git(remote, "show", "main:Home.md")).toBe("The owner's newer text.\n- from the bot");
  });

  test("a tool write with push pulls first, so a stale hash is refused against the remote", async () => {
    const { remote } = gitVault();
    const owner = ownerClone(remote);
    const vault = new Vault(botClone(remote));
    const append = agentTools().find((tool) => tool.name === "neiro_append");
    if (!append) throw new Error("no append tool");
    const { hash } = await vault.get("Home");
    owner.push("Home.md", "The owner's newer text.\n");
    const input = { note: "Home", text: "- from the bot", ifHash: hash };
    await expect(append.run(vault, validateInput(append, input), { push: true, author: BOT })).rejects.toThrow(
      WriteConflictError,
    );
    await append.run(vault, validateInput(append, { note: "Home", text: "- from the bot" }), {
      push: true,
      author: BOT,
    });
    expect(git(remote, "show", "main:Home.md")).toBe("The owner's newer text.\n- from the bot");
  });

  test("a sync that conflicts aborts the rebase and keeps the local commit", async () => {
    const { remote } = gitVault();
    const owner = ownerClone(remote);
    const dir = botClone(remote);
    const vault = new Vault(dir);
    await vault.append("Home", "- from the bot", { commit: true, author: BOT });
    owner.push("Home.md", "The owner rewrote it all.\n");
    await expect(vault.sync()).rejects.toThrow(/rebase was aborted and local commits kept/);
    expect(git(dir, "status", "--porcelain=v2", "--branch")).not.toContain("rebase");
    expect(existsSync(join(dir, ".git", "rebase-merge"))).toBe(false);
    expect(git(dir, "log", "-1", "--format=%an|%s")).toBe("vault-bot|docs: append to Home.md");
  });

  test("the tools push through the consumer's policy", async () => {
    const { remote } = gitVault();
    const vault = new Vault(botClone(remote));
    const capture = agentTools().find((tool) => tool.name === "neiro_capture");
    if (!capture) throw new Error("no capture tool");
    await capture.run(vault, validateInput(capture, { text: "Through a tool" }), { push: true, author: BOT });
    expect(git(remote, "log", "-1", "--format=%an|%s", "main")).toBe(
      "vault-bot|chore: capture Inbox/Through a tool.md",
    );
  });
});
