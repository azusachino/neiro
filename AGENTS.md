# AGENTS.md

Conventions for contributors and coding agents working in this repo. Read this and the [README](README.md) before changing anything.

## What this is

tsuzuri is an SDK and CLI over an Obsidian-compatible Markdown vault, working on the files directly. Its first consumers are the owner's terminal and a Telegram bot that imports the SDK in-process.

## Layout

One npm package at the repository root.

- `src/` is the package. `index.ts` is the prelude, the SDK's public entry; `tools.ts` is the `tsuzuri/tools` entry; `cli.ts` and `tools-cli.ts` are the two commands. Unit tests of internals sit beside the code as `*.test.ts`.
- `tests/` holds the contract tests, which import only `tsuzuri` and `tsuzuri/tools`, by the package's own name; `tests/fixtures/vault`, a small synthetic vault; and `tests/vaults/`, public Obsidian vaults pinned as submodules.
- `docs/` holds the [decisions](docs/decisions/README.md), the [roadmap](docs/roadmap.md) (update it with each change), the [CLI reference](docs/cli.md), and the [use cases](docs/use-cases.md); tests check the CLI reference and `skills/tsuzuri/SKILL.md` against the CLI.

## Toolchain and tasks

- **mise first:** Bun and Node are pinned in `.mise.toml`; run `mise install`.
- **make is the task runner:** `make check` (lint, typecheck, test) before every commit; `make validate` (check, build, and run the binary) before a PR. CI runs `make validate`, and `make node-smoke` on Node.
- **Portable by default:** new code uses standard `node:` modules and Web APIs that both Bun and Node provide. A Bun-only API belongs in a provider of a [fallback chain](docs/roadmap.md#capabilities-and-fallback-chains), with a portable provider that returns identical results.
- **Dependencies:** add a library only when it has released within the past year, has few or no dependencies of its own, and does something hard to get right. Otherwise implement the part tsuzuri needs.

## Rules

Each rule below is a decision record in [`docs/decisions/`](docs/decisions/README.md), which holds its reasons and the alternatives it rejected. Change a rule with a new record, not by editing this list.

- **Files are the only truth,** and tsuzuri keeps no index until a measurement asks for one. ([0002](docs/decisions/0002-files-are-the-only-truth.md))
- **Obsidian semantics, never the Obsidian app.** ([0003](docs/decisions/0003-obsidian-semantics-without-the-app.md))
- **Assume no layout or house style;** settings come from the settings chain, and test data is synthetic or public. ([0004](docs/decisions/0004-assume-no-layout-or-house-style.md))
- **The SDK reads and writes the whole vault:** it creates at any path, edits a section or key, and replaces a note, with `--dry-run` and `--if-hash` as optional guards; which of these a caller may use is the host's mask, not tsuzuri's. ([0016](docs/decisions/0016-the-sdk-reads-and-writes-the-whole-vault.md))
- **Every operation is in the operations table, with its kind;** a new `Vault` method that touches files, CLI command, or tool names its entry in `OPERATIONS`. A host limits them with a mask, and tsuzuri ships none. ([0018](docs/decisions/0018-operations-and-a-permission-mask.md))
- **Portable by default;** a Bun-only API lives in a fallback-chain provider. ([0006](docs/decisions/0006-portable-core-and-fallback-chains.md))
- **Maintained dependencies or own code.** ([0007](docs/decisions/0007-maintained-dependencies-or-own-code.md))
- **Files only:** no Git and no server. ([0008](docs/decisions/0008-files-only-no-git-no-server.md))
- **The CLI imports only the prelude** in `src/index.ts`, the SDK's public entry. ([0009](docs/decisions/0009-the-core-contract-and-prelude.md))
- **Agent tools are the `tsuzuri/tools` entry of the one package,** which imports only the prelude. ([0010](docs/decisions/0010-agent-tools-as-an-extension-package.md), [0012](docs/decisions/0012-one-npm-package-named-tsuzuri.md))
