# Changelog

## Unreleased

- **Breaking:** neiro works on files only ([ADR 0008](docs/decisions/0008-files-only-no-git-no-server.md)). Removed: `History`, `GitHistory`, `historyChain`, `HistoryError`, `PartialWriteError`, `Vault.history` and `Vault.sync()`, the `history`, `show`, and `diff` commands and the `neiro_history` tool, the `--commit`, `--push`, `--author`, `--rev`, and `--to` options, the `committed` and `pushed` result fields, and the agent tools' `context` argument. `--if-hash` and `--dry-run` stay. `docs/container.md` is gone; use case A10 is now a long-running process. ([#74](https://github.com/azusachino/neiro/issues/74))
- **Breaking:** the agent tools move out of `neiro` into the `neiro-tools` package in `packages/tools`, released at the same version ([ADR 0010](docs/decisions/0010-agent-tools-as-an-extension-package.md)). `agentTools`, `TOOLS`, `DEFAULT_EXPOSURE`, `validateInput`, `ToolInputError`, and their types import from `neiro-tools`; `neiro tools` becomes `neiro-tools`. The default exposure is agreed as it stood. The repository is now a Bun workspace with the core package in `packages/core`. ([#76](https://github.com/azusachino/neiro/issues/76))
- Decisions are recorded as ADRs in `docs/decisions/`, 0001 to 0010, and `AGENTS.md` and the roadmap link to them. ([#73](https://github.com/azusachino/neiro/issues/73))

## 0.5.0

- Links in frontmatter values and local Markdown links count for `links`, `backlinks`, `orphans`, and `unresolved`, as in Obsidian. ([#49](https://github.com/azusachino/neiro/issues/49))
- A wikilink to a note whose name contains a dot, such as `[[Node.js]]`, resolves to the note instead of being taken for an attachment. ([#50](https://github.com/azusachino/neiro/issues/50))
- An empty frontmatter block (`---` then `---`) is read as frontmatter, as in Obsidian, so `prop set` fills it instead of adding a second block. ([#51](https://github.com/azusachino/neiro/issues/51))
- `nav` no longer lists heading-like lines inside fenced code, and links and headings follow one fence rule: a fence closes only on a fence of the same character at least as long. ([#52](https://github.com/azusachino/neiro/issues/52))
- Every error neiro raises extends `NeiroError` and carries its class name. A date that is not a calendar date raises `InputError` and a malformed `neiro.toml` raises `ConfigError`; the CLI reports both in one line instead of a stack trace. ([#53](https://github.com/azusachino/neiro/issues/53))
- `neiro.toml` and code options are checked against the settings' shape: an unknown key or a value outside a setting's type or choices raises `ConfigError` naming it, instead of being ignored. ([#54](https://github.com/azusachino/neiro/issues/54))
- Git runs without blocking the process: `History` methods and `Vault.sync()` return promises, each git command stops after a timeout (60 seconds by default, `new GitHistory(root, { timeout })`), and git never waits for a credential prompt. The Git work-tree check runs once per vault. ([#57](https://github.com/azusachino/neiro/issues/57))
- The agent tools' `push` now pulls before each write as documented, so `ifHash` is checked against the remote's latest. A `sync` whose rebase conflicts aborts it and raises `HistoryError`, instead of leaving the clone mid-rebase. ([#55](https://github.com/azusachino/neiro/issues/55))
- A write whose commit or push fails after the file is written raises `PartialWriteError`, a `HistoryError` carrying the note's `path`, its new `hash`, and whether it `committed`, and the `Vault` rereads the file; before, the caller could not tell the note was written. ([#56](https://github.com/azusachino/neiro/issues/56))
- Targeted writes replace a note atomically, through a temporary file renamed over it, keeping its mode and any symbolic link, so a crash or a reader never sees half a note. ([#58](https://github.com/azusachino/neiro/issues/58))
- `neiro_grep` reads a model's pattern as literal text unless `regex` is set, refuses a pattern over 200 characters, and reports an invalid regular expression as `ToolInputError`, so a backtracking pattern cannot stall the host. Its `fixed` input is replaced by `regex`. ([#59](https://github.com/azusachino/neiro/issues/59))
- Reads that arrive while a `Vault` scans share that scan instead of each reading every file. ([#60](https://github.com/azusachino/neiro/issues/60))
- Small fixes: a long capture title is shortened by code point, never splitting an emoji; `neiro_get` refuses a malformed `lines` instead of reading the whole note; `neiro_list` checks that `where` values are text or null; `search` compiles each term's pattern once per query. ([#62](https://github.com/azusachino/neiro/issues/62))
- The SDK builds to JavaScript with declarations in `dist/lib`, which `exports` serves to Node and bundlers while Bun keeps the TypeScript source, so an installed package imports on Node. `make node-smoke` imports the built package from a `node_modules` folder. The `neiro` bin still runs the TypeScript source. ([#61](https://github.com/azusachino/neiro/issues/61))
- `links`, `backlinks`, `orphans`, and `unresolved` resolve every note's links once per scan and reuse the result, and extraction skips lines with no `[`. On a 1,837-note vault the first link query after a scan takes about 25 ms and later ones under 1 ms, against 23 ms for every query in 0.4.0. ([#64](https://github.com/azusachino/neiro/issues/64))
- Tests cover a vault checked out as a Git submodule, whose history lands in the submodule, and a bot sharing its owner's checkout: a capture adds one file and leaves the owner's staged and unstaged work as it was. ([#65](https://github.com/azusachino/neiro/issues/65))
- Use cases record the new behaviour with their covering tests, including A12, a bot serving from its owner's checkout, and A13, importing neiro on Node; the roadmap lists 0.5.0. ([#66](https://github.com/azusachino/neiro/issues/66))
- `neiro help <command>` and `<command> --help` show one command's arguments, options, and an example, and `neiro help --json` lists every command. One table in the CLI declares them and drives the usage; a command refuses an option it does not take instead of ignoring it. ([#68](https://github.com/azusachino/neiro/issues/68))
- With `--json`, a failure prints one JSON line on stderr, `{"error": {"name", "message", ...}}`, carrying the error's own fields such as `suggestions`, or a partial write's `path`, `hash`, and `committed`. Exit codes stay 1 and 2. ([#67](https://github.com/azusachino/neiro/issues/67))
- `neiro tools` lists each agent tool with its exposure and whether it reads, adds, or changes notes, and `neiro tools --json` prints the definitions, JSON Schemas included, so a coding agent with only the CLI sees the same operations as the SDK. ([#69](https://github.com/azusachino/neiro/issues/69))
- A [CLI reference](docs/cli.md) lists every command, option, JSON output shape, error, and exit code; a test fails when it misses a command or option the CLI declares. ([#70](https://github.com/azusachino/neiro/issues/70))
- `skills/neiro/SKILL.md` gives agents the command to reach for, the read-then-write sequence with a hash, and the next step for each JSON error, and ships in the package. It passes the Agent Skills validator, and a test checks its commands and options against the CLI. ([#71](https://github.com/azusachino/neiro/issues/71))

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
