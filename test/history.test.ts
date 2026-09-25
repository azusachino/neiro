import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GitHistory, HistoryError, PartialWriteError, UnsupportedError, Vault } from "../src/index.ts";
import { copyVault, git, gitVault } from "./git.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const NOTE = "Topics/Working memory.md";

/** A committed vault whose note has a second revision, returning both revision ids. */
async function revisedVault(): Promise<{ root: string; first: string; second: string }> {
  const { root } = gitVault();
  const first = git(root, "rev-parse", "HEAD");
  writeFileSync(join(root, NOTE), "Working memory holds about four chunks.\n");
  const second = await new GitHistory(root).commit(
    [NOTE],
    "docs: revise working memory",
    "editor <editor@example.com>",
  );
  return { root, first, second };
}

describe("GitHistory", () => {
  test("commits only the given paths, as the given author", async () => {
    const { root, second } = await revisedVault();
    writeFileSync(join(root, "Home.md"), "changed but not committed\n");
    expect(git(root, "show", "--name-only", "--format=%an|%s", second).split("\n")).toEqual([
      "editor|docs: revise working memory",
      "",
      NOTE,
    ]);
    expect(git(root, "status", "--porcelain")).toBe("M Home.md");
  });

  test("logs a note's revisions newest first, and shows and diffs them", async () => {
    const { root, first, second } = await revisedVault();
    const history = new GitHistory(root);
    expect((await history.log(NOTE)).map((revision) => revision.rev)).toEqual([second, first]);
    expect((await history.log(NOTE, 1))[0]).toMatchObject({ author: "editor", message: "docs: revise working memory" });
    expect(await history.show(NOTE, first)).toContain("Working memory holds a few items at once.");
    expect(await history.diff(NOTE, first, second)).toContain("+Working memory holds about four chunks.");
  });

  test("stops a git command that runs past its timeout", async () => {
    const { root } = await revisedVault();
    await expect(new GitHistory(root, { timeout: 1 }).log(NOTE)).rejects.toThrow(
      /git log failed: timed out after 1 ms/,
    );
  });

  test("resolves paths against a vault that sits below the repository root", async () => {
    const { root } = await revisedVault();
    const history = new GitHistory(join(root, "Topics"));
    expect(await history.log("Working memory.md")).toHaveLength(2);
    expect(await history.show("Working memory.md", "HEAD")).toBe("Working memory holds about four chunks.\n");
  });
});

describe("the history chain", () => {
  test("serves Git inside a work tree and raises UnsupportedError elsewhere, while reads keep working", async () => {
    expect(new Vault((await revisedVault()).root).history).toBeInstanceOf(GitHistory);
    const plain = new Vault(copyVault());
    expect(() => plain.history).toThrow(UnsupportedError);
    expect((await plain.notes()).length).toBeGreaterThan(0);
  });
});

describe("history commands", () => {
  const run = (root: string, ...args: string[]) =>
    spawnSync("bun", [CLI, "--vault", root, ...args], { encoding: "utf8" });

  test("history, show, and diff a note by reference", async () => {
    const { root, first } = await revisedVault();
    const revisions = JSON.parse(run(root, "history", "Working memory", "--json").stdout);
    expect(revisions.map((revision: { message: string }) => revision.message)).toEqual([
      "docs: revise working memory",
      "init",
    ]);
    expect(run(root, "show", "Working memory", "--rev", first).stdout).toContain("a few items at once");
    writeFileSync(join(root, NOTE), "Working memory, edited again.\n");
    expect(run(root, "diff", "Working memory").stdout).toContain("+Working memory, edited again.");
    expect(run(root, "diff", "Working memory", "--rev", first, "--to", "HEAD").stdout).toContain("four chunks");
  });

  test("exit 1 without Git or for an unknown revision, and 2 without --rev", async () => {
    expect(run(copyVault(), "history", "Working memory").status).toBe(1);
    const { root } = await revisedVault();
    expect(run(root, "show", "Working memory", "--rev", "nope").status).toBe(1);
    expect(run(root, "show", "Working memory").status).toBe(2);
  });
});

/** A Git hook that refuses whatever reaches it. */
function refuse(hooks: string, hook: string): void {
  writeFileSync(join(hooks, hook), "#!/bin/sh\nexit 1\n");
  chmodSync(join(hooks, hook), 0o755);
}

describe("a write that is not recorded", () => {
  test("names the captured note and its commit when the push fails", async () => {
    const { root, remote } = gitVault();
    refuse(join(remote, "hooks"), "pre-receive");
    const vault = new Vault(root);
    const error = await vault.capture({ text: "Kept locally" }, { push: true }).catch((caught) => caught);
    expect(error).toBeInstanceOf(PartialWriteError);
    expect(error).toBeInstanceOf(HistoryError);
    expect(error).toMatchObject({ path: "Inbox/Kept locally.md", committed: true });
    expect(error.message).toStartWith("Inbox/Kept locally.md was written and committed, but git push failed");
    expect(existsSync(join(root, "Inbox/Kept locally.md"))).toBe(true);
    expect(error.hash).toBe((await vault.get("Inbox/Kept locally.md")).hash);
  });

  test("names the note and its new hash when the commit fails", async () => {
    const { root } = gitVault();
    refuse(join(root, ".git", "hooks"), "pre-commit");
    const vault = new Vault(root);
    const error = await vault.append("Home", "- added", { commit: true }).catch((caught) => caught);
    expect(error).toBeInstanceOf(PartialWriteError);
    expect(error).toMatchObject({ path: "Home.md", committed: false });
    expect(error.hash).toBe((await vault.get("Home")).hash);
  });

  test("a pull that fails before writing leaves nothing to report", async () => {
    const { root } = gitVault();
    git(root, "remote", "set-url", "origin", join(root, "no-such-remote"));
    const error = await new Vault(root).capture({ text: "Never written" }, { push: true }).catch((caught) => caught);
    expect(error).toBeInstanceOf(HistoryError);
    expect(error).not.toBeInstanceOf(PartialWriteError);
    expect(existsSync(join(root, "Inbox/Never written.md"))).toBe(false);
  });
});
