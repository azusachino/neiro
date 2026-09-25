# AGENTS.md

Conventions for contributors and coding agents working in this repo. Read this and the [README](README.md) before changing anything.

## What this is

neiro is an SDK and CLI over an Obsidian-compatible Markdown vault, working on the files directly. Its first consumers are the owner's terminal and a Telegram bot that imports the SDK in-process.

## Layout

```text
packages/core/src/index.ts         The public SDK surface; everything a library consumer may import
packages/core/src/vault.ts         Vault: scanning, lookup, list, links, nav, and journal
packages/core/src/settings.ts      The settings chain: code options, neiro.toml, then neutral defaults
packages/core/src/errors.ts        NeiroError, the base of every error neiro raises on purpose
packages/core/src/chain.ts         Fallback chains: the first available provider serves a capability
packages/core/src/providers.ts     The capability chains; the only place a Bun-only API may appear
packages/core/src/links.ts         Link extraction (wikilinks, Markdown links, frontmatter) and Obsidian-style resolution
packages/core/src/search.ts        BM25 ranking over a scan
packages/core/src/capture.ts       Capture: one new note in the capture folder
packages/core/src/title.ts         Title casing and Latin/CJK spacing
packages/core/src/journal.ts       Periodic note paths from a folder and a format
packages/core/src/dateformat.ts    The moment-style date tokens Obsidian's periodic notes use
packages/core/src/frontmatter.ts   YAML frontmatter parsing and scalar quoting
packages/core/src/cli.ts           The CLI, a thin front end over the prelude
packages/core/src/*.test.ts        Unit tests of internals, beside the code they test
packages/tests/                    Contract tests through the public entries and the CLIs, the fixture, and the corpora
packages/tests/fixtures/vault      A small synthetic vault for edge cases; never copy personal notes into it
packages/tests/vaults/             Public Obsidian vaults pinned as submodules; tests assert invariants on them
skills/neiro/                      SKILL.md for agents using the CLI; a test checks its commands and options against the CLI
packages/core/src/tools.ts         The neiro/tools entry: agent tool definitions over the prelude, and nothing else
packages/core/src/tools-cli.ts     neiro-tools --json, which prints the definitions
docs/decisions/                    Architecture decision records: every rule below, with its reasons
docs/roadmap.md                    Shipped, next, and not-planned work; update it with each change
docs/cli.md                        Every CLI command, option, and JSON output; a test checks it against the CLI's command table
docs/use-cases.md                  Terminal and agent use cases, each with its status and covering tests
```

## Toolchain and tasks

- **mise first:** Bun and Node are pinned in `.mise.toml`; run `mise install`.
- **make is the task runner:** `make check` (lint, typecheck, test) before every commit; `make validate` (check, build, and run the binary) before a PR. CI runs `make validate`, and `make node-smoke` on Node.
- **Portable by default:** new code uses standard `node:` modules and Web APIs that both Bun and Node provide. A Bun-only API belongs in a provider of a [fallback chain](docs/roadmap.md#capabilities-and-fallback-chains), with a portable provider that returns identical results.
- **Dependencies:** add a library only when it has released within the past year, has few or no dependencies of its own, and does something hard to get right. Otherwise implement the part neiro needs.

## Rules

Each rule below is a decision record in [`docs/decisions/`](docs/decisions/README.md), which holds its reasons and the alternatives it rejected. Change a rule with a new record, not by editing this list.

- **Files are the only truth,** and neiro keeps no index until a measurement asks for one. ([0002](docs/decisions/0002-files-are-the-only-truth.md))
- **Obsidian semantics, never the Obsidian app.** ([0003](docs/decisions/0003-obsidian-semantics-without-the-app.md))
- **Assume no layout or house style;** settings come from the settings chain, and test data is synthetic or public. ([0004](docs/decisions/0004-assume-no-layout-or-house-style.md))
- **Capture creates; an edit targets one heading or key,** guarded by `--dry-run` and `--if-hash`. A new write verb needs the owner's agreement. ([0005](docs/decisions/0005-the-write-model.md))
- **Portable by default;** a Bun-only API lives in a fallback-chain provider. ([0006](docs/decisions/0006-portable-core-and-fallback-chains.md))
- **Maintained dependencies or own code.** ([0007](docs/decisions/0007-maintained-dependencies-or-own-code.md))
- **Files only:** no Git and no server. ([0008](docs/decisions/0008-files-only-no-git-no-server.md))
- **The CLI imports only the prelude** in `packages/core/src/index.ts`, the SDK's public entry. ([0009](docs/decisions/0009-the-core-contract-and-prelude.md))
- **Agent tools are the `neiro/tools` entry of the one package,** which imports only the prelude. ([0010](docs/decisions/0010-agent-tools-as-an-extension-package.md), [0012](docs/decisions/0012-one-npm-package-named-tsuzuri.md))
