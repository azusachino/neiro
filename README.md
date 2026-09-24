# neiro

An SDK and CLI for reading and capturing into an Obsidian-compatible Markdown vault. It works on the files directly: Obsidian does not need to be installed or running. It is built for a personal vault that is used from the terminal and read by a Telegram bot, which imports the SDK in-process.

The command vocabulary follows [Obsidian's own CLI](https://obsidian.md/help/cli), but the model follows [notesmd-cli](https://github.com/Yakitrak/notesmd-cli): files are the only source of truth, and there is no index to build or keep fresh. A full scan of a 1,837-note vault answers a search in about 200 ms, including process start-up.

## Commands

```text
neiro get <note>              one note by path, filename, title, or alias
neiro search <query...>       BM25 ranking with title and tag boosts; CJK matches as substrings
neiro list                    notes filtered by --type, --tag, --status, --under
neiro nav [folder]            a folder's index note, subfolders, and notes
neiro links <note>            outgoing wikilinks and how each resolves
neiro backlinks <note>        notes linking to a note
neiro unresolved              links pointing at no note, or at several
neiro journal <period>        the day, week, month, quarter, or year note for --date (default: today)
neiro capture [text...]       create a new note
```

Every command accepts `--json`. The vault is `--vault <dir>`, else `$NEIRO_VAULT`, else the current directory. Run `neiro --help` for every option.

Wikilinks resolve the way Obsidian resolves them: a vault-root path, a path relative to the linking note's folder, a unique path suffix, then a unique filename stem, preferring the linking note's own folder. A link that still matches several notes is reported as ambiguous rather than guessed. A note without a `title` property takes its title from its file name, as in Obsidian.

## Settings

neiro assumes no folder layout or house style. Each setting is resolved in this order, and the first source that has it wins:

1. options passed in code (`new Vault(root, { config })`), in the shape of `neiro.toml`
2. `neiro.toml` at the vault root
3. the vault's own Obsidian settings in `.obsidian/`
4. a neutral default, or an `UnsupportedError` naming what is missing

| Setting | Read from Obsidian | Default |
| --- | --- | --- |
| capture folder | "Default location for new notes" (`app.json`) | the vault root |
| day journal | Periodic Notes, then core Daily Notes (`daily-notes.json`) | `UnsupportedError` |
| week, month, quarter, and year journals | Periodic Notes (`plugins/periodic-notes/data.json`) | `UnsupportedError` |

Journal paths use Obsidian's moment-style formats, such as `YYYY-MM-DD` or `gggg-[W]ww`, and a format may contain `/` for subfolders.

A `neiro.toml` declaring a stricter house style:

```toml
[capture]
folder = "inbox"
filename = "slug"                  # ASCII kebab-case; the default "title" names files as Obsidian does
properties = ["title", "created", "modified", "status", "tags", "source"]
timestamp_format = "YYYY-MM-DD HH:mm"
title_style = "lowercase"          # lowercase title words, except those in the allowlist
title_allowlist = "casing.toml"    # every string in this file's arrays is kept as written
tag_style = "kebab"                # canonical lowercase kebab-case; the default keeps tags as written
require_tags = true
reject_tags = ["todo"]

[capture.values]
status = "inbox"

[journal.week]
folder = "journal"
format = "GGGG/[weekly]/GGGG-[W]WW"
```

Paths listed in the vault's `.gitmodules`, dot folders such as `.obsidian` and `.trash`, and `node_modules` are never scanned.

## Capture

`capture` is the only write. It always creates a new file in the capture folder, so it never edits a note the owner is working on and cannot conflict with it.

```sh
neiro capture --tag llm --source https://example.com/post "Read: how agents plan"
printf -- '- white miso\n- red miso\n' | neiro capture --tag cooking --title "Miso to try"
neiro capture -- "- text starting with a dash goes after --"
```

- The title is the first line of the text unless `--title` is given, with Markdown markers removed.
- By default the note's frontmatter holds only its tags and source, when given; the note has no frontmatter at all without them. `properties` and `[capture.values]` in `neiro.toml` declare more.
- By default the file is named after the title, with characters Obsidian refuses in file names removed, and a taken name gets a number, as in `Idea 2.md`. The `slug` style uses an ASCII kebab-case stem with a `-2` suffix, falling back to `capture-YYYYMMDD-HHmm` for a title with no ASCII letters.
- Tags must use Obsidian's tag syntax: letters, numbers, `_`, `-`, and `/` for nesting, with at least one non-digit.

`--dry-run` prints the note without writing. `--commit` commits only the new file, optionally as `--author "Name <email>"`. `--push` pulls with rebase first, then commits and pushes.

## SDK

```ts
import { Vault } from "neiro";

const vault = new Vault(process.env.NEIRO_VAULT ?? ".");
const hits = await vault.search("distributed consensus", { limit: 5 });
const note = await vault.get(hits[0].path, { maxChars: 8000 });
const today = await vault.journalFor("day"); // from .obsidian/daily-notes.json or neiro.toml
await vault.capture({ text: "An idea", tags: ["learning"] }, { push: true, author: "bot <bot@example.com>" });
```

A `Vault` scans once and caches the notes. Call `vault.reload()` after the files change underneath it, for example after a `git pull`.

## Development

Bun, rumdl, and typos are pinned in `.mise.toml`; run `mise install`, then:

```sh
make install    # dependencies from bun.lock, plus the kepano-obsidian test vault
make check      # Biome lint and format, tsc, rumdl, typos, and tests
make validate   # check, then build dist/neiro and run it against the fixture vault
make build      # compile the CLI into a single binary at dist/neiro
make corpus     # fetch the opt-in obsidian-help vault (about 635 MB), which the tests then include
```

Tests run against a small synthetic vault and against real public Obsidian vaults pinned under `test/vaults/`: [kepano-obsidian](https://github.com/kepano/kepano-obsidian) in CI, and Obsidian's own [help vault](https://github.com/obsidianmd/obsidian-help) on request. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE).
