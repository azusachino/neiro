# neiro

An SDK and CLI for reading and capturing into an Obsidian-compatible Markdown vault. It works on the files directly: Obsidian does not need to be installed or running. It is built for a personal vault that is used from the terminal and read by a Telegram bot, which imports the SDK in-process.

The command vocabulary follows [Obsidian's own CLI](https://obsidian.md/help/cli), but the model follows [notesmd-cli](https://github.com/Yakitrak/notesmd-cli): files are the only source of truth, and there is no index to build or keep fresh. A full scan of a 1,837-note vault answers a search in about 200 ms, including process start-up.

## Commands

```text
neiro get <note>              one note by path, filename, title, or alias
neiro search <query...>       BM25 ranking with title and tag boosts; CJK matches as substrings
neiro list                    notes filtered by --type, --tag, --status, --under
neiro nav [folder]            a folder's index.md, subfolders, and notes
neiro links <note>            outgoing wikilinks and how each resolves
neiro backlinks <note>        notes linking to a note
neiro unresolved              links pointing at no note, or at several
neiro journal <week|month>    the journal note for --date (default: today)
neiro capture [text...]       create a new inbox note
```

Every command accepts `--json`. The vault is `--vault <dir>`, else `$NEIRO_VAULT`, else the current directory. Run `neiro --help` for every option.

Wikilinks resolve the way Obsidian resolves them: a vault-root path, a path relative to the linking note's folder, a unique path suffix, then a unique filename stem, preferring the linking note's own folder. A link that still matches several notes is reported as ambiguous rather than guessed.

## Capture

`capture` is the only write. It always creates a new file under `inbox/`, so it never edits a note the owner is working on and cannot conflict with it.

```sh
neiro capture --tag llm --source https://example.com/post "read: how agents plan"
printf -- '- white miso\n- red miso\n' | neiro capture --tag cooking --title "miso to try"
neiro capture --tag cooking -- "- text starting with a dash goes after --"
```

The note gets the vault's frontmatter in canonical order, with `type: inbox`, `status: inbox`, and `maturity: seed`:

- The title is the first line of the text unless `--title` is given, with Markdown markers removed. Words are lowercased except those on the vault's title allowlist, and Latin text is spaced apart from CJK text.
- At least one `--tag` is required. Tags are canonicalized to lowercase kebab-case, and workflow words such as `inbox` are rejected.
- The filename is an ASCII slug of the title. A title with no ASCII letters falls back to `capture-YYYYMMDD-HHMM`, and a taken name gets a `-2` suffix.

`--dry-run` prints the note without writing. `--commit` commits only the new file, optionally as `--author "Name <email>"`. `--push` pulls with rebase first, then commits and pushes.

## Vault configuration

A vault may declare its conventions in `neiro.toml` at its root. Every key is optional:

```toml
[journal]
week = "journal/{isoYear}/weekly/{isoYear}-w{ww}.md"   # the default
month = "journal/{yyyy}/monthly/{yyyy}-{mm}.md"         # the default

[capture]
# Title words kept as written. Every string in the file's arrays is allowed.
title_allowlist = "scripts/configs/title-casing.toml"
```

Without an allowlist, capture keeps words written entirely in capitals, such as `API`. Paths listed in the vault's `.gitmodules`, dot folders, and `node_modules` are never scanned.

## SDK

```ts
import { Vault } from "neiro";

const vault = new Vault(process.env.NEIRO_VAULT ?? ".");
const hits = await vault.search("distributed consensus", { limit: 5 });
const note = await vault.get(hits[0].path, { maxChars: 8000 });
const week = await vault.journalFor("week", new Date());
await vault.capture({ text: "an idea", tags: ["learning"] }, { push: true, author: "bot <bot@example.com>" });
```

A `Vault` scans once and caches the notes. Call `vault.reload()` after the files change underneath it, for example after a `git pull`.

## Development

Bun is pinned in `.mise.toml`; run `mise install`, then:

```sh
make install    # dependencies from bun.lock
make check      # lint, typecheck, test
make validate   # check, then build dist/neiro and run it against the fixture vault
make build      # compile the CLI into a single binary at dist/neiro
```
