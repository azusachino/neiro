# AGENTS.md

Conventions for contributors and coding agents working in this repo. Read this and the [README](README.md) before changing anything.

## What this is

neiro is an SDK and CLI over an Obsidian-compatible Markdown vault, working on the files directly. Its first vault is Apricot; its first consumers are the owner's terminal and the luna Telegram bot, which imports the SDK in-process.

## Layout

```text
src/index.ts         The public SDK surface; everything luna may import
src/vault.ts         Vault: scanning, lookup, list, links, nav, journal, and neiro.toml
src/links.ts         Wikilink extraction and Obsidian-style resolution
src/search.ts        BM25 ranking over a scan
src/capture.ts       The one write: a new inbox note, optionally committed and pushed
src/title.ts         Title casing and Latin/CJK spacing
src/journal.ts       ISO-week and month journal paths
src/frontmatter.ts   YAML frontmatter parsing and scalar quoting
src/cli.ts           The CLI, a thin front end over src/index.ts
test/fixtures/vault  A synthetic vault; never copy personal notes into it
```

## Toolchain and tasks

- **mise first:** Bun is pinned in `.mise.toml`; run `mise install`.
- **make is the task runner:** `make check` (lint, typecheck, test) before every commit; `make validate` (check, build, and run the binary) before a PR. CI runs `make validate`.
- Prefer Bun and Web APIs (`Bun.Glob`, `Bun.file`, `Bun.spawnSync`, `Bun.TOML`, `Bun.CryptoHasher`); use `node:` modules where Bun has no equivalent.

## Rules

- **Files are the only truth.** Do not add an index, cache file, or database until a measurement shows the scan is too slow; any index must be derived and deletable.
- **Never require the Obsidian app.** luna runs in a pod with no GUI.
- **Capture creates, never edits.** It writes one new file under `inbox/`, and `--commit` commits only that file. A new write verb needs the owner's agreement first, and must target a heading or a frontmatter key rather than rewriting a note.
- **Vault conventions belong to the vault.** Apricot-specific rules come from its `neiro.toml`, not from constants here. The defaults may match Apricot's layout, but must stay overridable.
- **The CLI imports only `src/index.ts`,** so it cannot depend on anything luna cannot use.
- **Fixtures are synthetic.** Tests must never read the real vault or copy its content.
