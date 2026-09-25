# neiro

An SDK and CLI for reading and capturing into an Obsidian-compatible Markdown vault. It works on the files directly: Obsidian does not need to be installed or running. It is built for a personal vault that is used from the terminal and read by a Telegram bot, which imports the SDK in-process.

The command vocabulary follows [Obsidian's own CLI](https://obsidian.md/help/cli), but the model follows [notesmd-cli](https://github.com/Yakitrak/notesmd-cli): files are the only source of truth, and there is no index to build or keep fresh. A full scan of a 1,837-note vault answers a search in about 200 ms, including process start-up.

## Commands

```text
neiro get <note>              one note by path, filename, title, or alias
neiro search <query...>       BM25 ranking with title and tag boosts; CJK matches as substrings
neiro list                    notes filtered by --type, --tag, --status, --under
neiro nav [folder]            a folder's index note, subfolders, and notes
neiro links <note>            outgoing links and how each resolves
neiro backlinks <note>        notes linking to a note
neiro unresolved              links pointing at no note, or at several
neiro journal <period>        the day, week, month, quarter, or year note for --date (default: today)
neiro capture [text...]       create a new note
```

Every command accepts `--json`. Commands that return notes (`get`, `search`, `list`, `nav`, `backlinks`) share one summary (path, title, type, status, tags, created, modified), accept `--fields a,b` to keep named fields or any frontmatter key, and `--format paths` to print one path per line for `xargs` or `fzf`. `find <query>` ranks notes by fuzzy match over paths, titles, and aliases with fzf's scoring rules, CJK included, and a failed `get` names the closest notes. `list --where key=value --sort modified --desc --limit 10` filters on any frontmatter property and sorts by `modified`, `created`, `title`, or `path`. `tags` lists every tag with its note count. `new <type> <title>` creates a note from the vault's template for that type (`Book` or `Book Template`), filling `{{title}}`, `{{date}}`, and `{{time}}` as Obsidian's core Templates do, and places it as `capture` does. `append <note> <text> [--heading H]`, `section put <note> --heading H`, and `journal append <period> <text>` change one part of a note, `prop set <note> <key> <value>` sets one frontmatter key keeping comments and order, and `put <path>` creates a note or replaces it only with `--if-hash`: each takes `--dry-run` for a diff, `--if-hash` to refuse a note changed since `get` read it, and `--commit` for one commit of that note alone. A text argument that starts with a dash and a space is a Markdown bullet, not an option. `history <note>`, `show <note> --rev <rev>`, and `diff <note>` read a note's revisions through Git; without Git they raise `UnsupportedError` and every read still works. `orphans` lists notes nothing links to, `outline <note>` gives headings with their line numbers, and `prop get <note> <key>` returns one frontmatter value. `--tag` may repeat, and matches the way Obsidian does: case-insensitively, with `area` matching `area/sub`. `grep <pattern>` prints matching lines as `path:line:text`, like `rg -n`, with smart case, `-F` for literal text, and `-C <n>` for context. `get` reads part of a note by line, counted from the top of the file as `rg -n` counts: `--lines 20:60`, or `--around <line|path:line> --context <n>`, which takes an `rg -n` result unchanged. The vault is `--vault <dir>`, else `$NEIRO_VAULT`, else the current directory. Run `neiro --help` for every option.

Wikilinks resolve the way Obsidian resolves them: a vault-root path, a path relative to the linking note's folder, a unique path suffix, then a unique filename stem, preferring the linking note's own folder. A link that still matches several notes is reported as ambiguous rather than guessed. As in Obsidian, wikilinks in frontmatter values and Markdown links to vault files such as `[text](My%20Note.md)` count as links too. A note without a `title` property takes its title from its file name, as in Obsidian.

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

An unknown key or a value of the wrong type or choice in `neiro.toml` or code options raises `ConfigError` naming it. Journal paths use Obsidian's moment-style formats, such as `YYYY-MM-DD` or `gggg-[W]ww`, and a format may contain `/` for subfolders.

A `neiro.toml` declaring a stricter house style:

```toml
[capture]
folder = "inbox"
filename = "slug"                  # ASCII kebab-case; the default "title" names files as Obsidian does
properties = ["title", "created", "modified", "status", "tags", "source"]
timestamp_format = "YYYY-MM-DD HH:mm"  # the default "YYYY-MM-DD" is the format of Obsidian's Date property
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

[templates]
folder = "templates"               # else Obsidian's Templates folder; neither means `new` is unsupported
```

Paths listed in the vault's `.gitmodules`, dot folders such as `.obsidian` and `.trash`, `node_modules`, and anything the vault root's `.gitignore` ignores are never scanned, as ripgrep skips them.

## Capture

`capture` is the only write. It always creates a new file in the capture folder, so it never edits a note the owner is working on and cannot conflict with it.

```sh
neiro capture --tag llm --source https://example.com/post "Read: how agents plan"
printf -- '- white miso\n- red miso\n' | neiro capture --tag cooking --title "Miso to try"
neiro capture -- "- text starting with a dash goes after --"
neiro capture --file tmp/draft.md --tag reading     # a whole Markdown file, frontmatter included
```

- The title is the first line of the text unless `--title` is given, with Markdown markers removed. With `--file`, the file's `title` property comes first, then its first heading, then its file name, and its `tags`, `source`, and other properties carry over; `--tag` adds to its tags. Properties the vault declares are always filled by capture itself.
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

Every error neiro raises on purpose extends `NeiroError`, so one `instanceof` check separates them from bugs. A `Vault` scans once and caches the notes. [Running neiro in a container](docs/container.md) covers a bot on a Git clone of the vault. A long-running process passes `watch: 1000` to have reads rescan, at most once a second, when the notes' paths, modification times, or sizes change; `await vault.sync()` pulls and pushes through `History`, then reloads. Git runs without blocking the process, and each command stops after a timeout. Otherwise call `vault.reload()` after the files change underneath it.

### Agent tools

`agentTools()` returns ready-made tool definitions for a tool-calling model: a `neiro_` name, a JSON Schema for the input, MCP-style `readOnlyHint`, `destructiveHint`, and `idempotentHint`, an `exposure`, and a `run` bound to the SDK. Validate a model's input with `validateInput`, then call `run(vault, input, { commit, push, author })`; the consumer, not the model, decides whether writes commit and push.

The default exposure follows the roadmap's proposal, pending the owner's agreement: reads, `neiro_capture`, and `neiro_journal_append` are `direct`; `neiro_append`, `neiro_section_put`, `neiro_prop_set`, and `neiro_new` need a human's `confirm`; `neiro_put` is never offered. `neiro_grep` reads a model's pattern as literal text unless it sets `regex`, and caps it at 200 characters, since a regular expression runs in the host's process. Pass a changed copy of `DEFAULT_EXPOSURE` to `agentTools` to change it.

## Development

Bun, Node, rumdl, and typos are pinned in `.mise.toml`; run `mise install`, then:

```sh
make install    # dependencies from bun.lock, plus the kepano-obsidian test vault
make check      # Biome lint and format, tsc, rumdl, typos, and tests
make validate   # check, then build dist/neiro and run it against the fixture vault
make build      # compile the CLI into a single binary at dist/neiro
make node-smoke # run the read commands on Node and compare their output with Bun's
make corpus     # fetch the opt-in obsidian-help vault (about 635 MB), which the tests then include
```

Tests run against a small synthetic vault and against real public Obsidian vaults pinned under `test/vaults/`: [kepano-obsidian](https://github.com/kepano/kepano-obsidian) in CI, and Obsidian's own [help vault](https://github.com/obsidianmd/obsidian-help) on request. See [CONTRIBUTING.md](CONTRIBUTING.md).

See the [roadmap](docs/roadmap.md) for what comes next.

## License

[MIT](LICENSE).
