import { execFile, spawnSync } from "node:child_process";
import { Chain } from "./chain.ts";
import { NeiroError } from "./errors.ts";

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
  commit(paths: string[], message: string, author?: string): Promise<string>;
  /** Revisions that touched the path, newest first. */
  log(path: string, limit?: number): Promise<Revision[]>;
  /** The path's content at a revision. */
  show(path: string, rev: string): Promise<string>;
  /** A unified diff of the path between two revisions, or from a revision to the working file. */
  diff(path: string, from: string, to?: string): Promise<string>;
  /**
   * Take others' revisions first, then publish this one's. When they conflict, the store is left as it was before
   * the call, local revisions kept, and a `HistoryError` says a person must reconcile it.
   */
  sync(): Promise<void>;
}

export class HistoryError extends NeiroError {}

export interface GitHistoryOptions {
  /** Milliseconds a git command may run before it is stopped; 60 seconds by default. */
  timeout?: number;
}

/**
 * History through the git CLI, run in the vault root, which may sit anywhere inside a repository. Commands run
 * without blocking the process, stop after `timeout`, and never wait for a credential prompt.
 */
export class GitHistory implements History {
  readonly root: string;
  private readonly timeout: number;

  constructor(root: string, options: GitHistoryOptions = {}) {
    this.root = root;
    this.timeout = options.timeout ?? 60_000;
  }

  private git(args: string[]): Promise<string> {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
    const options = { cwd: this.root, encoding: "utf8" as const, env, timeout: this.timeout, maxBuffer: 64 << 20 };
    return new Promise((resolve, reject) => {
      execFile("git", args, options, (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        const reason = error.killed ? `timed out after ${this.timeout} ms` : stderr.trim() || error.message;
        reject(new HistoryError(`git ${args[0]} failed: ${reason}`));
      });
    });
  }

  async commit(paths: string[], message: string, author?: string): Promise<string> {
    await this.git(["add", "--", ...paths]);
    await this.git(["commit", "--quiet", "-m", message, ...(author ? ["--author", author] : []), "--", ...paths]);
    return (await this.git(["rev-parse", "HEAD"])).trim();
  }

  async log(path: string, limit = 20): Promise<Revision[]> {
    const out = await this.git(["log", `--max-count=${limit}`, "--format=%H%x1f%aI%x1f%an%x1f%s", "--", path]);
    return out
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const [rev = "", date = "", author = "", message = ""] = line.split("\x1f");
        return { rev, date, author, message };
      });
  }

  show(path: string, rev: string): Promise<string> {
    // `./` makes the path relative to the vault root rather than to the repository's top level.
    return this.git(["show", `${rev}:./${path}`]);
  }

  diff(path: string, from: string, to?: string): Promise<string> {
    return this.git(["diff", from, ...(to ? [to] : []), "--", path]);
  }

  async sync(): Promise<void> {
    try {
      await this.git(["pull", "--rebase", "--quiet"]);
    } catch (error) {
      // A conflicting rebase stops halfway and blocks every later commit; put the clone back as it was.
      const stopped = await this.git(["rebase", "--abort"]).then(
        () => true,
        () => false,
      );
      if (!stopped) throw error;
      throw new HistoryError(
        "git pull failed: local revisions conflict with the remote; the rebase was aborted and local commits kept, so a person must reconcile them",
      );
    }
    await this.git(["push", "--quiet"]);
  }
}

function insideGit(root: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
  });
  return result.status === 0 && result.stdout.trim() === "true";
}

/** The history chain for a vault root: Git when the root is inside a work tree, otherwise `UnsupportedError`. */
export function historyChain(root: string): Chain<History> {
  let inside: boolean | undefined;
  return new Chain<History>("record history", [
    {
      name: "git",
      requires: "a Git work tree at the vault root",
      // Checked once: a vault does not become a work tree, or stop being one, under a running process.
      available: () => (inside ??= insideGit(root)),
      impl: new GitHistory(root),
    },
  ]);
}
