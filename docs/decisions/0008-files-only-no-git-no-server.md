# 0008 files only: no Git and no server

Status: accepted, 2026-09-25 (0.6.0). Supersedes the commit steps of [ADR 0005](0005-the-write-model.md).

## context

Git entered neiro step by step. `capture --commit --push` shipped in 0.1.0, a `History` interface with `history`, `show`, `diff`, and `--commit` on every edit in 0.3.0, `Vault.sync()` and a guide to running a bot on a Git clone in 0.4.0, and pull-first agent writes, conflict aborts, timeouts, and partial-write reports in 0.5.0. Each step made Git safer inside neiro, and each widened what neiro had to own: the git binary, its timeouts and credential prompts, rebase conflicts, and a second copy of the vault to keep in step.

The deployment that motivated it changed. The owner edits one checkout, and the bot runs on the same machine against that checkout, never committing; the owner commits its captures with their own work. Nothing neiro does with notes needs Git: its write guard, the content hash, works on the files alone.

A long-running server was on the not-planned list until a second consumer needed one. It was reconsidered as a way for a bot on another machine to reach the owner's checkout, and dropped when the bot moved to the same machine.

## decision

A vault is its current files. neiro does not stage, commit, push, pull, or read revisions, and has no `History`, `sync()`, `history`, `show`, or `diff`, and no `--commit`, `--push`, or `--author`. Versioning, sharing, and conflicts belong to the owner, through Git or whatever else they use to keep the files. neiro runs as an SDK in the caller's process and as a CLI, never as a server.

## alternatives considered

- **Keep Git writes and make them safer**: the 0.5.0 direction, reversed because the safety work kept growing around something neiro does not need.
- **Keep read-only history** (`history`, `show`, `diff`): rejected because `git log -- <path>` does the same, and keeping them keeps the git dependency.
- **A server over HTTP or MCP** for consumers on other machines: not planned, since no consumer needs one.

## consequences

neiro loses its git binary dependency, timeouts, and failure modes, and a write is complete when the file is written. A consumer that wants a commit per write runs Git itself afterwards. The 0.3.0 to 0.5.0 roadmap entries describe features that no longer exist and stay as history. This is a breaking change to the SDK and the CLI.
