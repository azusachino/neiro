# Changelog

## Unreleased

- Links in frontmatter values and local Markdown links count for `links`, `backlinks`, `orphans`, and `unresolved`, as in Obsidian. ([#49](https://github.com/azusachino/neiro/issues/49))
- A wikilink to a note whose name contains a dot, such as `[[Node.js]]`, resolves to the note instead of being taken for an attachment. ([#50](https://github.com/azusachino/neiro/issues/50))
- An empty frontmatter block (`---` then `---`) is read as frontmatter, as in Obsidian, so `prop set` fills it instead of adding a second block. ([#51](https://github.com/azusachino/neiro/issues/51))
- `nav` no longer lists heading-like lines inside fenced code, and links and headings follow one fence rule: a fence closes only on a fence of the same character at least as long. ([#52](https://github.com/azusachino/neiro/issues/52))
- Every error neiro raises extends `NeiroError` and carries its class name. A date that is not a calendar date raises `InputError` and a malformed `neiro.toml` raises `ConfigError`; the CLI reports both in one line instead of a stack trace. ([#53](https://github.com/azusachino/neiro/issues/53))
- `neiro.toml` and code options are checked against the settings' shape: an unknown key or a value outside a setting's type or choices raises `ConfigError` naming it, instead of being ignored. ([#54](https://github.com/azusachino/neiro/issues/54))
- Git runs without blocking the process: `History` methods and `Vault.sync()` return promises, each git command stops after a timeout (60 seconds by default, `new GitHistory(root, { timeout })`), and git never waits for a credential prompt. The Git work-tree check runs once per vault. ([#57](https://github.com/azusachino/neiro/issues/57))
- The agent tools' `push` now pulls before each write as documented, so `ifHash` is checked against the remote's latest. A `sync` whose rebase conflicts aborts it and raises `HistoryError`, instead of leaving the clone mid-rebase. ([#55](https://github.com/azusachino/neiro/issues/55))
- A write whose commit or push fails after the file is written raises `PartialWriteError`, a `HistoryError` carrying the note's `path`, its new `hash`, and whether it `committed`, and the `Vault` rereads the file; before, the caller could not tell the note was written. ([#56](https://github.com/azusachino/neiro/issues/56))

## 0.4.0

- Agent tools: `agentTools()` returns a definition per operation with a closed JSON Schema, MCP-style read-only, destructive, and idempotent hints, an exposure (`direct`, `confirm`, or `cli-only`), and a `run` bound to the SDK. `validateInput` rejects malformed calls. The consumer, not the model, decides whether writes commit and push. The default exposure follows the roadmap's proposal, pending the owner's agreement.
- A refresh policy for long-running processes: `watch` rescans when the notes' modification times change, at most once per interval, and `Vault.sync()` pulls and pushes through `History`, then reloads.
- A guide to running neiro against a Git clone of a vault in a container, tested against a bare remote.

## 0.3.0

- A `History` interface with `GitHistory` through the git CLI; `history`, `show --rev`, and `diff` read a note's revisions. Without Git, history raises `UnsupportedError` and every read still works; `capture --commit` then fails before writing.
- Targeted writes: `append` (to a note or a section), `journal append`, `section put`, `prop set` (comments and key order kept), `put` (create, or replace only with `--if-hash`), and `new` from the vault's templates.
- Every write previews with `--dry-run` as a unified diff, refuses a stale `--if-hash`, changes only its target range, and commits that note alone with `--commit`. Nothing deletes.
- Bullets and negative numbers on the command line are text, not options. Emoji tags are valid.

## 0.2.0

- The SDK runs on Bun and Node. Bun-only APIs sit behind fallback chains (TOML, then YAML frontmatter with `Bun.YAML` first) whose providers return identical results.
- Every command that returns notes returns one summary (path, title, type, status, tags, created, modified), with `--fields` and `--format paths`.
- New reads: `get --lines` and `get --around` (which takes an `rg -n` result), `grep`, fuzzy `find` (a failed `get` names the closest notes), `tags`, `orphans`, `outline`, and `prop get`.
- Filters: `--where` on any frontmatter property, several `--tag` flags with Obsidian's tag semantics, and `list --sort`, `--desc`, and `--limit`.
- Scans honor the vault's `.gitignore`.
- `created` and `modified` default to the date format `YYYY-MM-DD`, Obsidian's Date property.

## 0.1.0

- Reads: `get`, `search`, `list`, `nav`, `links`, `backlinks`, `unresolved`, and `journal` for day, week, month, quarter, and year, as a Bun SDK and a compiled CLI.
- `capture` creates one new note from text, stdin, or a Markdown file, keeping the file's properties, and can commit and push only that file.
- Settings come from code options, then `neiro.toml`, then the vault's Obsidian settings (new-note location, Daily Notes, Periodic Notes), then neutral defaults. No folder layout or house style is assumed.
- Tests run against a synthetic fixture and the public kepano-obsidian vault, with Obsidian's help vault as an opt-in corpus.
