import { spawnSync } from "node:child_process";
import { Chain } from "./chain.ts";

/** One recorded revision of a note. */
export interface Revision {
  rev: string;
  /** ISO 8601, with the author's offset. */
  date: string;
  author: string;
  message: string;
}

/** A vault's revision store. Paths are vault-relative POSIX paths. */
export interface History {
  /** Record exactly these paths in one revision, returning its id. */
  commit(paths: string[], message: string, author?: string): string;
  /** Revisions that touched the path, newest first. */
  log(path: string, limit?: number): Revision[];
  /** The path's content at a revision. */
  show(path: string, rev: string): string;
  /** A unified diff of the path between two revisions, or from a revision to the working file. */
  diff(path: string, from: string, to?: string): string;
  /** Take others' revisions first, then publish this one's. */
  sync(): void;
}

export class HistoryError extends Error {}

/** History through the git CLI, run in the vault root, which may sit anywhere inside a repository. */
export class GitHistory implements History {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  private git(args: string[]): string {
    const result = spawnSync("git", args, { cwd: this.root, encoding: "utf8" });
    if (result.status !== 0) {
      const reason = result.error?.message ?? (result.stderr.trim() || `exit ${result.status}`);
      throw new HistoryError(`git ${args[0]} failed: ${reason}`);
    }
    return result.stdout;
  }

  commit(paths: string[], message: string, author?: string): string {
    this.git(["add", "--", ...paths]);
    this.git(["commit", "--quiet", "-m", message, ...(author ? ["--author", author] : []), "--", ...paths]);
    return this.git(["rev-parse", "HEAD"]).trim();
  }

  log(path: string, limit = 20): Revision[] {
    const out = this.git(["log", `--max-count=${limit}`, "--format=%H%x1f%aI%x1f%an%x1f%s", "--", path]);
    return out
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const [rev = "", date = "", author = "", message = ""] = line.split("\x1f");
        return { rev, date, author, message };
      });
  }

  show(path: string, rev: string): string {
    // `./` makes the path relative to the vault root rather than to the repository's top level.
    return this.git(["show", `${rev}:./${path}`]);
  }

  diff(path: string, from: string, to?: string): string {
    return this.git(["diff", from, ...(to ? [to] : []), "--", path]);
  }

  sync(): void {
    this.git(["pull", "--rebase", "--quiet"]);
    this.git(["push", "--quiet"]);
  }
}

function insideGit(root: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, encoding: "utf8" });
  return result.status === 0 && result.stdout.trim() === "true";
}

/** The history chain for a vault root: Git when the root is inside a work tree, otherwise `UnsupportedError`. */
export function historyChain(root: string): Chain<History> {
  return new Chain<History>("record history", [
    {
      name: "git",
      requires: "a Git work tree at the vault root",
      available: () => insideGit(root),
      impl: new GitHistory(root),
    },
  ]);
}
