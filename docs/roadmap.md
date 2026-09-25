# roadmap

What neiro does, what comes next, and what it will not do. Each planned item links to its GitHub issue, which holds its status and acceptance criteria; this page holds the order and the reasons. Update this page in the same PR that ships or reorders an item. The design rules in [AGENTS.md](../AGENTS.md) bound everything here, and [use cases](use-cases.md) records what each item is for and which tests hold it.

## principles

The rules that bound this roadmap are [decision records](decisions/README.md): files are the only truth ([0002](decisions/0002-files-are-the-only-truth.md)), Obsidian semantics without the app ([0003](decisions/0003-obsidian-semantics-without-the-app.md)), no assumed layout ([0004](decisions/0004-assume-no-layout-or-house-style.md)), earned and guarded writes ([0005](decisions/0005-the-write-model.md)), a portable core ([0006](decisions/0006-portable-core-and-fallback-chains.md)), maintained dependencies or own code ([0007](decisions/0007-maintained-dependencies-or-own-code.md)), files only with no Git or server ([0008](decisions/0008-files-only-no-git-no-server.md)), one note model and a public contract ([0009](decisions/0009-the-core-contract-and-prelude.md)), and agent tools as an extension ([0010](decisions/0010-agent-tools-as-an-extension-package.md)).

## shipped

### 0.5.0: design review and agent CLI

The fixes from a best-practice review, and a CLI made for agents, in [#63](https://github.com/azusachino/neiro/pull/63); the [changelog](../CHANGELOG.md) lists each with its issue.

- **Obsidian's links:** frontmatter wikilinks and Markdown links count, a dotted note name resolves to the note, and links, headings, and frontmatter share one parser each for fences and blocks. ([#49](https://github.com/azusachino/neiro/issues/49)–[#52](https://github.com/azusachino/neiro/issues/52))
- **Errors and settings:** every error extends `NeiroError`, and `neiro.toml` is checked against its shape. ([#53](https://github.com/azusachino/neiro/issues/53), [#54](https://github.com/azusachino/neiro/issues/54))
- **A bot's writes:** Git runs without blocking and with a timeout, agent writes pull first, a conflicting rebase is aborted, a write saved but not pushed is reported, and writes are atomic. ([#55](https://github.com/azusachino/neiro/issues/55)–[#58](https://github.com/azusachino/neiro/issues/58))
- **An agent's reach:** `neiro_grep` is literal by default, with a pattern cap. ([#59](https://github.com/azusachino/neiro/issues/59))
- **Speed, measured on a 1,837-note vault:** reads during a scan share it, and links resolve once per scan. ([#60](https://github.com/azusachino/neiro/issues/60), [#64](https://github.com/azusachino/neiro/issues/64))
- **Agent-facing CLI:** per-command help from one command table, JSON errors under `--json`, `neiro tools`, a [CLI reference](cli.md), and a [SKILL.md](../packages/core/skills/neiro/SKILL.md), each checked against the CLI by a test. ([#67](https://github.com/azusachino/neiro/issues/67)–[#71](https://github.com/azusachino/neiro/issues/71))
- **Consumers:** a compiled build for Node, tests for a vault in a submodule shared with its owner, and use cases A12 and A13. ([#61](https://github.com/azusachino/neiro/issues/61), [#65](https://github.com/azusachino/neiro/issues/65), [#66](https://github.com/azusachino/neiro/issues/66))

### 0.4.0: agent integration

- Export ready-made tool definitions: names, parameter schemas, and read-only or destructive hints for each operation. ([#19](https://github.com/azusachino/neiro/issues/19))
- A default exposure for agents, following this proposal and pending the owner's agreement (overridable through `agentTools`): `capture` and `journal append` directly; `append`, `section put`, and `prop set` behind a human confirmation step; `put` stays CLI-only. ([#19](https://github.com/azusachino/neiro/issues/19))
- A `Vault` refresh policy for a long-running process: reload after `git pull`, or when the files' modification times change. ([#20](https://github.com/azusachino/neiro/issues/20))
- A documented way to run neiro against a Git clone of the vault in a container, synced through `History`. ([#21](https://github.com/azusachino/neiro/issues/21))

### 0.3.0: history and targeted writes

The Git features of 0.1 to 0.5 (commits, pushes, `History`, `sync()`, and the history commands) were removed in 0.6 by [ADR 0008](decisions/0008-files-only-no-git-no-server.md); these entries record what shipped at the time.

Every write in this milestone previews as a unified diff with `--dry-run`, refuses to run when `--if-hash` does not match the note's current hash, commits once, and changes only its target. Diffs come from [`diff`](https://www.npmjs.com/package/diff); patches are neiro's own range splices, sd's "touch only the match" idea applied to Markdown structure. Nothing deletes. Shared write safety is [#13](https://github.com/azusachino/neiro/issues/13).

- **A `History` interface** with `commit`, `log`, `show`, `diff`, and `sync`. `GitHistory` implements it through the git CLI; in a folder without Git, the history chain raises `UnsupportedError` instead of pretending to record anything. Capture's Git calls move behind it. ([#12](https://github.com/azusachino/neiro/issues/12))
- **History commands:** `history <note>`, `show <note> --rev <rev>`, and `diff <note>`. Restoring is an ordinary write: read an old revision and `put` it with `--if-hash`, which makes a new revision instead of rewriting history. ([#12](https://github.com/azusachino/neiro/issues/12))
- **`append <note> <text> [--heading H]`**: at the end of the note, or at the end of section H. A missing heading fails unless `--create-heading` is given. ([#14](https://github.com/azusachino/neiro/issues/14))
- **`section put <note> --heading H`**: replace section H's body, or create the section. ([#15](https://github.com/azusachino/neiro/issues/15))
- **`prop set <note> <key> <value>`**: upsert one frontmatter key, keeping comments and key order. ([#16](https://github.com/azusachino/neiro/issues/16))
- **`put <path>`**: create a note, or replace it only with a matching `--if-hash`. Replacing without the hash is refused. ([#17](https://github.com/azusachino/neiro/issues/17))
- **`journal append <week|month> <text> --heading <h>`**: `append` on the note for a date. ([#14](https://github.com/azusachino/neiro/issues/14))
- **`new <type> <title>`** from the vault's templates. ([#18](https://github.com/azusachino/neiro/issues/18))
- Also: an argument starting with a dash and a space, or a negative number, is text rather than an option, so bullets and values such as `-428` reach a write unchanged; a capture keeps a template's empty properties as `key:`; emoji tags such as `0🌲` are valid, as in Obsidian.

Which of these an agent may call is decided in 0.4, not by this milestone.

### 0.2.0: portable core and reads that agents can aim

- **Portable core.** Replace the eight Bun-only calls with `node:` modules or a fallback chain, and add a Node run to CI next to Bun. The [fallback chains](#capabilities-and-fallback-chains) start here. ([#2](https://github.com/azusachino/neiro/issues/2))
- **Parse frontmatter through the YAML chain, `Bun.YAML` first.** It parses that vault's 1,837 frontmatter blocks in 12 ms instead of 53 ms. `Bun.YAML` alone disagrees with `yaml` on unquoted `{{placeholders}}`, repeated keys, merge keys, tags, and directives, so a block containing any of them goes to `yaml`; the two then agree on all 8,049 blocks of the corpora and that vault. ([#3](https://github.com/azusachino/neiro/issues/3))
- **Return the same metadata from every command.** Search hits gain `type`, `status`, `tags`, `created`, and `modified`, alongside `score` and `snippet`. `--fields` limits the output to named fields, including any frontmatter key, like the `select` clause in SilverBullet's queries. ([#4](https://github.com/azusachino/neiro/issues/4))
- **Read by line.** `get <note> --lines 20:60` and `--around <line> --context <n>` return a slice plus `start`, `end`, and `total`. Line numbers count from the top of the file, frontmatter included, so they match `rg -n`, editors, and Git diffs. ([#5](https://github.com/azusachino/neiro/issues/5))
- **`grep <pattern>`**, printing `path:line:text` like `rg -n`, with `-F` for literal text and ripgrep's smart case: case-insensitive unless the pattern contains a capital. Grep to find, then read the lines around a hit. ([#6](https://github.com/azusachino/neiro/issues/6))
- **`find <query>`**, fuzzy matching over paths, titles, and aliases, ranked with fzf's scoring rules in neiro's own implementation. A failed `get` suggests the closest matches instead of only reporting not found. ([#7](https://github.com/azusachino/neiro/issues/7))
- **`tags`**: every tag with its note count, so an agent picks an existing tag instead of inventing one. ([#8](https://github.com/azusachino/neiro/issues/8))
- **Obsidian tag semantics.** Matching is case-insensitive, and a nested tag `area/sub` matches a filter on `area`. `tags` written as one string (`a, b`) and `#`-prefixed values are read too. Several `--tag` flags must all match. ([#8](https://github.com/azusachino/neiro/issues/8))
- **Filter and sort any frontmatter key.** `--where key=value` works on any property, not only `type` and `status`. `--sort modified|created|title|path` with `--desc` and `--limit` cover "recently touched" and "latest books". ([#9](https://github.com/azusachino/neiro/issues/9))
- **Honor the vault's `.gitignore`**, as ripgrep does, using [`ignore`](https://www.npmjs.com/package/ignore). ([#10](https://github.com/azusachino/neiro/issues/10))
- **`--format paths`**: one path per line, for `xargs` and `fzf`. ([#4](https://github.com/azusachino/neiro/issues/4))
- **More reads:** `orphans` (notes nothing links to), `outline <note>` (headings), and `prop get <note> <key>`. ([#11](https://github.com/azusachino/neiro/issues/11))
- Decided by measurement: file listing is a plain `node:fs` walk rather than a `Bun.Glob` chain, and `grep` scans in process rather than behind an `rg -l` prefilter. See [capabilities and fallback chains](#capabilities-and-fallback-chains).
- Still open: whether Obsidian resolves a bare alias link needs a check in the app ([#24](https://github.com/azusachino/neiro/issues/24)).

### 0.1.0

- Reads: `get`, `search`, `list`, `nav`, `links`, `backlinks`, `unresolved`, and `journal` for day, week, month, quarter, and year. Every command supports `--json`.
- The one write: `capture`, which creates a new note from text, stdin, or a Markdown file (`--file`) and can commit and push only that file.
- No layout or house style is assumed. Settings resolve from code options, then `neiro.toml`, then the vault's Obsidian settings (new-note location, Daily Notes, Periodic Notes), then neutral defaults or `UnsupportedError`. Journal paths use Obsidian's moment-style formats.
- Tests run against a synthetic fixture and real public vaults pinned as submodules: kepano-obsidian in CI and Obsidian's help vault, 6,386 notes in about 30 languages, on request.
- Measured on a real vault of 1,837 notes and 8.3 M characters: 18 ms process start-up, about 10 ms to find files, 25 ms to read them, and **100 ms to parse YAML frontmatter**. After loading, `list` takes 0.5 ms, `search` 17–33 ms, and `backlinks` 25 ms.

## next

No milestone is planned. Work beyond 0.5 waits for a need: the items under [later, only if a measurement asks for it](#later-only-if-a-measurement-asks-for-it), and whether Obsidian resolves a bare alias link ([#24](https://github.com/azusachino/neiro/issues/24)), which needs a check in the app.

## capabilities and fallback chains

Each capability has a chain of providers, and the first one available in the current environment serves the call. A provider declares whether it is available (a runtime API exists, a binary is on `PATH`, the vault is a Git repository), and it must return exactly what the portable provider returns. A speed-up that changes results is a bug, not a trade-off. Where no provider is available, neiro raises an `UnsupportedError` naming the capability and what is missing, rather than degrading silently.

| Capability | Chain, first available wins | Notes |
| --- | --- | --- |
| parse YAML | `Bun.YAML` → [`yaml`](https://www.npmjs.com/package/yaml) | `Bun.YAML` takes a block only without flow mappings, merge keys, tags, explicit keys, directives, or a repeated key, where the two parsers disagree; identical on 8,049 blocks from the corpora and a real vault |
| parse TOML | `Bun.TOML` → [`smol-toml`](https://www.npmjs.com/package/smol-toml) | only for `neiro.toml` and the allowlist it names |
| settings | code options → `neiro.toml` → neutral default | shipped in 0.1.0; a journal period with no source raises `UnsupportedError` |
| templates | `neiro.toml` → none | for `new` ([#18](https://github.com/azusachino/neiro/issues/18)) |

Plain `node:fs/promises`, `node:crypto`, and `node:child_process` cover listing, reading, writing, hashing, and spawning in every supported runtime, so they need no chain. Listing was planned as a `Bun.Glob` chain, but a `node:fs` walk returned the same 6,386 paths from obsidian-help in 11–17 ms against `Bun.Glob`'s 31–36 ms, on Bun itself. Content search was planned with an `rg -l` prefilter, but on a real 1,837-note vault the in-process scan of already-loaded notes takes 12 ms against 34 ms for `rg -l`, which would save about 20 ms only on a one-shot CLI call; ripgrep's regex dialect and ignore rules would also let it drop files neiro matches. `grep` scans in process only. Tests run each chain with every provider forced in turn against the fixture vault and require identical output.

## own code and libraries

neiro borrows the ideas of the owner's daily terminal tools and depends on none of them. ripgrep is an optional provider above; `sd` and `fzf` remain tools for working on the vault by hand.

| Idea | Taken from | How neiro gets it |
| --- | --- | --- |
| `path:line:text`, smart case, `-F` literal | ripgrep | own code; a few lines each |
| honor `.gitignore` | ripgrep | [`ignore`](https://www.npmjs.com/package/ignore): MIT, no dependencies, released 2026-09 |
| fuzzy ranking over paths, titles, and aliases | fzf | own code: subsequence matching with fzf's bonuses for word boundaries, path separators, and consecutive characters, plus CJK-aware matching |
| preview before writing | sd `-p` | [`diff`](https://www.npmjs.com/package/diff): BSD-3, no dependencies, released 2026-04 |
| change only the match | sd | own code: splice the target range and leave every other byte unchanged |

Libraries measured against this policy and rejected are listed in [ADR 0007](decisions/0007-maintained-dependencies-or-own-code.md).

## later, only if a measurement asks for it

- **Objects inside notes**, as SilverBullet indexes them: headers, list items, and tasks with their own tags and attributes. `neiro tasks` would be the first consumer.
- **A derived cache.** One SQLite file keyed by path, size, and modification time, used only when a cold load becomes too slow. It must be deletable at any time with no loss.
- **Local embeddings for Chinese recall.** A composed Chinese phrase that is not a literal substring still finds nothing. If that becomes a daily failure, add a local multilingual embedding model in the Basic Memory style, rebuilt from the files.

## not planned

- Anything that needs the Obsidian app, a plugin, or Obsidian Sync.
- `delete`. Archiving is a move, and even that waits for rename support that rewrites links.
- A query language such as SilverBullet's Lua queries. Flags cover the filters and sorts people use; a language would give a model an arbitrary-code surface.
- Git: committing, pushing, pulling, or reading revisions ([ADR 0008](decisions/0008-files-only-no-git-no-server.md)).
- A server over HTTP or MCP ([ADR 0008](decisions/0008-files-only-no-git-no-server.md)).
