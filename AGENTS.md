# AGENTS.md

Conventions for contributors and coding agents working in this repo. Read this and the [README](README.md) before changing anything.

## What this is

neiro is an SDK and CLI over an Obsidian-compatible Markdown vault, working on the files directly. Its first consumers are the owner's terminal and a Telegram bot that imports the SDK in-process.

## Layout

```text
src/index.ts         The public SDK surface; everything a library consumer may import
src/vault.ts         Vault: scanning, lookup, list, links, nav, and journal
src/settings.ts      The settings chain: code options, neiro.toml, .obsidian settings, defaults
src/errors.ts        NeiroError, the base of every error neiro raises on purpose
src/chain.ts         Fallback chains: the first available provider serves a capability
src/providers.ts     The capability chains; the only place a Bun-only API may appear
src/links.ts         Link extraction (wikilinks, Markdown links, frontmatter) and Obsidian-style resolution
src/search.ts        BM25 ranking over a scan
src/capture.ts       The one write: a new note, optionally committed and pushed
src/title.ts         Title casing and Latin/CJK spacing
src/journal.ts       Periodic note paths from a folder and a format
src/dateformat.ts    The moment-style date tokens Obsidian's periodic notes use
src/frontmatter.ts   YAML frontmatter parsing and scalar quoting
src/cli.ts           The CLI, a thin front end over src/index.ts
test/fixtures/vault  A small synthetic vault for edge cases; never copy personal notes into it
test/vaults/         Public Obsidian vaults pinned as submodules; tests assert invariants on them
docs/roadmap.md      Shipped, next, and not-planned work; update it with each change
docs/use-cases.md    Terminal and agent use cases, each with its status and covering tests
docs/container.md    Running neiro against a Git clone of a vault in a container
```

## Toolchain and tasks

- **mise first:** Bun and Node are pinned in `.mise.toml`; run `mise install`.
- **make is the task runner:** `make check` (lint, typecheck, test) before every commit; `make validate` (check, build, and run the binary) before a PR. CI runs `make validate`, and `make node-smoke` on Node.
- **Portable by default:** new code uses standard `node:` modules and Web APIs that both Bun and Node provide. A Bun-only API belongs in a provider of a [fallback chain](docs/roadmap.md#capabilities-and-fallback-chains), with a portable provider that returns identical results.
- **Dependencies:** add a library only when it has released within the past year, has few or no dependencies of its own, and does something hard to get right. Otherwise implement the part neiro needs.

## Rules

- **Files are the only truth.** Do not add an index, cache file, or database until a measurement shows the scan is too slow; any index must be derived and deletable.
- **Never require the Obsidian app.** The bot runs in a container with no GUI.
- **Capture creates, never edits.** It writes one new file in the capture folder, and `--commit` commits only that file. A new write verb needs the owner's agreement first, and must target a heading or a frontmatter key rather than rewriting a note.
- **Assume no layout or house style.** Folders, frontmatter fields, file naming, title and tag rules, and journal paths come from the settings chain. A default must be neutral Obsidian behaviour, never one vault's convention; where Obsidian has no default, raise `UnsupportedError`.
- **The CLI imports only `src/index.ts`,** so it cannot depend on anything a library consumer cannot use.
- **Test data is synthetic or public.** Tests use the fixture or the pinned public vaults, never a personal vault or text copied from one. A vault-specific behaviour is tested through `VaultOptions.config`.
