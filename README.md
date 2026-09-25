# neiro

An SDK and CLI for reading and writing an Obsidian-compatible Markdown vault. It works on the files directly: Obsidian does not need to be installed or running. It is built for a personal vault that is used from the terminal and by a Telegram bot, which imports the SDK in-process.

The command vocabulary follows [Obsidian's own CLI](https://obsidian.md/help/cli), but the model follows [notesmd-cli](https://github.com/Yakitrak/notesmd-cli): files are the only source of truth, and there is no index to build or keep fresh. A full scan of a 1,837-note vault answers a search in about 200 ms, including process start-up.

## Quick start

```sh
make install && make build          # the CLI at packages/core/dist/neiro
export NEIRO_VAULT=~/notes          # or pass --vault <dir>; the default is the current directory

neiro nav                           # the vault's top folders and notes
neiro search cognitive load --limit 5
neiro get "Cognitive load" --json   # one note, with the hash a later write needs
neiro capture --tag reading "Read: how agents plan"
```

`neiro help` lists every command, `neiro help <command>` gives one command's options and an example, and the [CLI reference](docs/cli.md) has every option and JSON output shape.

## Commands

### Read

| Command | What it returns |
| --- | --- |
| `get <note>` | one note by path, file name, title, or alias; `--lines 20:60` or `--around <path:line>` for part of it |
| `search <query...>` | notes ranked by BM25 with title and tag boosts; CJK matches as substrings |
| `grep <pattern>` | matching lines as `path:line:text`, like `rg -n`, with smart case, `-F`, and `-C <n>` |
| `find <query...>` | notes by fuzzy match over paths, titles, and aliases, ranked as fzf ranks |
| `list` | notes filtered by `--type`, `--tag`, `--status`, `--under`, or `--where key=value`, and sorted |
| `tags` | every tag with its note count |
| `prop get <note> <key>` | one frontmatter value |
| `journal <period>` | the day, week, month, quarter, or year note for `--date` (default: today) |

### Navigate and link

| Command | What it returns |
| --- | --- |
| `nav [folder]` | a folder's index note and headings, its subfolders, and its notes |
| `outline <note>` | a note's headings with their line numbers |
| `links <note>` | a note's outgoing links and how each resolves |
| `backlinks <note>` | notes that link to a note |
| `orphans` | notes nothing links to or embeds |
| `unresolved` | links pointing at no note, or at several |

### Write

| Command | What it changes |
| --- | --- |
| `capture [text...]` | creates a new note in the capture folder, from text, `--file`, or stdin |
| `new <type> <title...>` | creates a note from the vault's template for a type, placed as `capture` places it |
| `append <note> [text...]` | adds text at the end of a note, or of section `--heading` |
| `section put <note> [text...]` | replaces the body of section `--heading`, or adds the section |
| `prop set <note> <key> <value>` | sets one frontmatter key, keeping comments and key order |
| `journal append <period> [text...]` | appends to the periodic note for `--date`, which must exist |
| `put <path> [text...]` | creates a note, or replaces one only with `--if-hash` |

`capture` and `new` only create files, so they never touch a note the owner is editing. Every edit changes only its target and takes two guards: `--dry-run` shows a unified diff, and `--if-hash <hash>` refuses a note changed since `get` returned that hash. neiro only writes files; committing and syncing them is the owner's, through Git or whatever else keeps the vault ([ADR 0008](docs/decisions/0008-files-only-no-git-no-server.md)). A text argument that starts with a dash and a space is a Markdown bullet, not an option.

`neiro tools` lists the same operations as agent tools, and `neiro tools --json` prints their definitions.

## Output and errors

- `--json` makes stdout one JSON value. Commands that return notes share one summary: `path`, `title`, `type`, `status`, `tags`, `created`, and `modified`.
- `--fields a,b` keeps only the named fields, a summary field or any frontmatter key, and `--format paths` prints one path per line for `xargs` or `fzf`.
- With `--json`, a failure prints one line on stderr, `{"error": {"name", "message", ...}}`, such as `NotFoundError` with the closest notes in `suggestions`.
- The exit code is 1 for a request neiro refused or could not serve, and 2 for bad usage. A command refuses an option it does not take.

## Links

Wikilinks resolve the way Obsidian resolves them: a vault-root path, a path relative to the linking note's folder, a unique path suffix, then a unique file name, preferring the linking note's own folder. A link that still matches several notes is reported as ambiguous rather than guessed. As in Obsidian, wikilinks in frontmatter values and Markdown links to vault files such as `[text](My%20Note.md)` count as links too. A note without a `title` property takes its title from its file name.

Tags match the way Obsidian matches them: case-insensitively, with `area` matching `area/sub`. `--tag` may repeat, and every tag must match.

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
| template folder | core Templates (`templates.json`) | `UnsupportedError` for `new` |

An unknown key, or a value of the wrong type or choice, in `neiro.toml` or code options raises `ConfigError` naming it. Journal paths use Obsidian's moment-style formats, such as `YYYY-MM-DD` or `gggg-[W]ww`, and a format may contain `/` for subfolders.

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
folder = "templates"               # else Obsidian's Templates folder
```

Paths listed in the vault's `.gitmodules`, dot folders such as `.obsidian` and `.trash`, `node_modules`, and anything the vault root's `.gitignore` ignores are never scanned, as ripgrep skips them.

## Capture

```sh
neiro capture --tag llm --source https://example.com/post "Read: how agents plan"
printf -- '- white miso\n- red miso\n' | neiro capture --tag cooking --title "Miso to try"
neiro capture -- "- text starting with a dash goes after --"
neiro capture --file tmp/draft.md --tag reading     # a whole Markdown file, frontmatter included
```

- The title is the first line of the text unless `--title` is given, with Markdown markers removed. With `--file`, the file's `title` property comes first, then its first heading, then its file name, and its `tags`, `source`, and other properties carry over; `--tag` adds to its tags.
- By default the frontmatter holds only the tags and source, when given, and a note without either has no frontmatter. `properties` and `[capture.values]` in `neiro.toml` declare more, and capture always fills the properties the vault declares.
- By default the file is named after the title, without the characters Obsidian refuses in file names, and a taken name gets a number, as in `Idea 2.md`. The `slug` style uses an ASCII kebab-case stem with a `-2` suffix, falling back to `capture-YYYYMMDD-HHmm` for a title with no ASCII letters.
- Tags use Obsidian's tag syntax: letters, numbers, `_`, `-`, and `/` for nesting, with at least one non-digit.
- `--dry-run` prints the note without writing.

## SDK

```ts
import { Vault } from "neiro";

const vault = new Vault(process.env.NEIRO_VAULT ?? ".");
const hits = await vault.search("distributed consensus", { limit: 5 });
const note = await vault.get(hits[0].path, { maxChars: 8000 });
const today = await vault.journalFor("day"); // from .obsidian/daily-notes.json or neiro.toml
await vault.capture({ text: "An idea", tags: ["learning"] });
```

- Bun imports the TypeScript source; Node and bundlers import the JavaScript and declarations that `make build` writes to `dist/lib`, which packing the package builds too.
- Every error neiro raises on purpose extends `NeiroError`, so one `instanceof` check separates them from bugs.
- A `Vault` scans once and caches the notes. Call `vault.reload()` after the files change underneath it, or, in a long-running process, pass `watch: 1000` to have reads rescan, at most once a second, when the notes' paths, modification times, or sizes change.

### Agent tools

`agentTools()` returns ready-made tool definitions for a tool-calling model: a `neiro_` name, a JSON Schema for the input, MCP-style `readOnlyHint`, `destructiveHint`, and `idempotentHint`, an `exposure`, and a `run` bound to the SDK. Validate a model's input with `validateInput`, then call `run(vault, input)`.

The default exposure follows the roadmap's proposal, pending the owner's agreement: reads, `neiro_capture`, and `neiro_journal_append` are `direct`; `neiro_append`, `neiro_section_put`, `neiro_prop_set`, and `neiro_new` need a human's `confirm`; `neiro_put` is never offered. Pass a changed copy of `DEFAULT_EXPOSURE` to `agentTools` to change it. `neiro_grep` reads a model's pattern as literal text unless it sets `regex`, and caps it at 200 characters, since a regular expression runs in the host's process.

### Agent skill

[`SKILL.md`](packages/core/skills/neiro/SKILL.md) tells a coding agent which command to reach for, how to write without overwriting the owner (read the `hash`, `--dry-run`, then `--if-hash`), and what to do about each JSON error. It is self-contained, so an installer that copies only the skill's folder can use it, and a test fails when it names a command or option the CLI does not take.

## Development

Bun, Node, rumdl, and typos are pinned in `.mise.toml`; run `mise install`, then:

```sh
make install    # dependencies from bun.lock, plus the kepano-obsidian test vault
make check      # Biome lint and format, tsc, rumdl, typos, and tests
make validate   # check, then build the CLI and run it against the fixture vault
make build      # compile the CLI into one binary, and the SDK into dist/lib, in packages/core
make node-smoke # run the read commands on Node, and import the built SDK there, comparing with Bun
make corpus     # fetch the opt-in obsidian-help vault (about 635 MB), which the tests then include
```

Tests run against a small synthetic vault and against real public Obsidian vaults pinned under `packages/core/test/vaults/`: [kepano-obsidian](https://github.com/kepano/kepano-obsidian) in CI, and Obsidian's own [help vault](https://github.com/obsidianmd/obsidian-help) on request. See [CONTRIBUTING.md](CONTRIBUTING.md), the [use cases](docs/use-cases.md), and the [roadmap](docs/roadmap.md).

## License

[MIT](LICENSE).
