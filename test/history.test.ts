import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { GitHistory, UnsupportedError, Vault } from "../src/index.ts";
import { copyVault, git, gitVault } from "./git.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const NOTE = "Topics/Working memory.md";

/** A committed vault whose note has a second revision, returning both revision ids. */
function revisedVault(): { root: string; first: string; second: string } {
  const { root } = gitVault();
  const first = git(root, "rev-parse", "HEAD");
  writeFileSync(join(root, NOTE), "Working memory holds about four chunks.\n");
  const second = new GitHistory(root).commit([NOTE], "docs: revise working memory", "editor <editor@example.com>");
  return { root, first, second };
}

describe("GitHistory", () => {
  test("commits only the given paths, as the given author", () => {
    const { root, second } = revisedVault();
    writeFileSync(join(root, "Home.md"), "changed but not committed\n");
    expect(git(root, "show", "--name-only", "--format=%an|%s", second).split("\n")).toEqual([
      "editor|docs: revise working memory",
      "",
      NOTE,
    ]);
    expect(git(root, "status", "--porcelain")).toBe("M Home.md");
  });

  test("logs a note's revisions newest first, and shows and diffs them", () => {
    const { root, first, second } = revisedVault();
    const history = new GitHistory(root);
    expect(history.log(NOTE).map((revision) => revision.rev)).toEqual([second, first]);
    expect(history.log(NOTE, 1)[0]).toMatchObject({ author: "editor", message: "docs: revise working memory" });
    expect(history.show(NOTE, first)).toContain("Working memory holds a few items at once.");
    expect(history.diff(NOTE, first, second)).toContain("+Working memory holds about four chunks.");
  });

  test("resolves paths against a vault that sits below the repository root", () => {
    const { root } = revisedVault();
    const history = new GitHistory(join(root, "Topics"));
    expect(history.log("Working memory.md")).toHaveLength(2);
    expect(history.show("Working memory.md", "HEAD")).toBe("Working memory holds about four chunks.\n");
  });
});

describe("the history chain", () => {
  test("serves Git inside a work tree and raises UnsupportedError elsewhere, while reads keep working", async () => {
    expect(new Vault(revisedVault().root).history).toBeInstanceOf(GitHistory);
    const plain = new Vault(copyVault());
    expect(() => plain.history).toThrow(UnsupportedError);
    expect((await plain.notes()).length).toBeGreaterThan(0);
  });
});

describe("history commands", () => {
  const run = (root: string, ...args: string[]) =>
    spawnSync("bun", [CLI, "--vault", root, ...args], { encoding: "utf8" });

  test("history, show, and diff a note by reference", () => {
    const { root, first } = revisedVault();
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

  test("exit 1 without Git or for an unknown revision, and 2 without --rev", () => {
    expect(run(copyVault(), "history", "Working memory").status).toBe(1);
    const { root } = revisedVault();
    expect(run(root, "show", "Working memory", "--rev", "nope").status).toBe(1);
    expect(run(root, "show", "Working memory").status).toBe(2);
  });
});
