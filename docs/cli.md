# cli reference

Every `neiro` command, its options, and what `--json` returns. `neiro help <command>` prints the same for one command, and `neiro help --json` prints all of it as JSON. A test fails when this page misses a command or option the CLI declares.

## global options

| Option | Meaning |
| --- | --- |
| `--vault <dir>` | vault root (default: $NEIRO_VAULT, then the current directory) |
| `--json` | machine-readable output and errors, the same as --format json |
| `--format <text\|json\|paths>` | paths prints one path per line, for xargs and fzf |
| `-h, --help` | show help, for one command when one is given |
| `-v, --version` | show the version |

The vault is `--vault`, else `$NEIRO_VAULT`, else the current directory. A command refuses an option it does not take. A text argument that starts with a dash and a space, or a negative number, is text rather than an option; anything else starting with a dash goes after `--`.

## output and errors

Text output is for people. With `--json`, stdout is one JSON value, shaped as each command below says. Commands that return notes share one summary: `path`, `title`, `type`, `status`, `tags`, `created`, and `modified`, the optional ones only when set. `--fields a,b` keeps only the named fields, a summary field or any frontmatter key, `null` when absent, and `--format paths` prints one path per line.

With `--json`, a failure prints one line on stderr, `{"error": {"name", "message", ...}}`, with the error's own fields: `suggestions` on `NotFoundError`, and `path`, `hash`, and `committed` on `PartialWriteError`, a write that was saved but not recorded.

| Exit | Meaning |
| --- | --- |
| 0 | done |
| 1 | a request neiro refused or could not serve: `NotFoundError`, `WriteConflictError`, `UnsupportedError`, `ConfigError`, and the other `NeiroError`s |
| 2 | bad usage: `UsageError` |

## reads

### get

`neiro get <note>`

Print one note by path, file name, title, or alias; the JSON carries its hash for --if-hash.

| Option | Meaning |
| --- | --- |
| `--lines <a:b>` | lines a to b, counted from the top of the file (a:, :b, or one line) |
| `--around <line\|path:line>` | a line and --context lines either side; accepts rg -n output |
| `-C, --context <n>` | lines either side (get --around: 5 by default) |
| `--max-chars <n>` | truncate the note body |
| `--fields <a,b,...>` | only these fields: summary fields such as score, or any frontmatter key |

With `--json`: a note: the summary fields, `frontmatter`, `body`, `hash`, `truncated`, and with `--lines` or `--around` its `start`, `end`, and `total` lines.

```sh
neiro get "Working memory" --lines 1:20 --json
```

### search

`neiro search <query...>`

Rank notes by relevance (BM25; CJK matches as substrings).

| Option | Meaning |
| --- | --- |
| `--type <type>` | only notes whose type property is this |
| `--tag <tag>` | a tag, may repeat: capture and new add it; elsewhere every tag must match, case-insensitively, and area matches area/sub |
| `--status <status>` | only notes whose status property is this |
| `--under <folder>` | only notes in this folder |
| `--where <key=value\|key>` | filter on any frontmatter property; may repeat; a bare key means present |
| `--limit <n>` | most results |
| `--fields <a,b,...>` | only these fields: summary fields such as score, or any frontmatter key |

With `--json`: hits: the summary fields plus `score` and `snippet`.

```sh
neiro search cognitive load --limit 5 --json
```

### grep

`neiro grep <pattern>`

Matching lines as path:line:text, like rg -n (smart case).

| Option | Meaning |
| --- | --- |
| `--type <type>` | only notes whose type property is this |
| `--tag <tag>` | a tag, may repeat: capture and new add it; elsewhere every tag must match, case-insensitively, and area matches area/sub |
| `--status <status>` | only notes whose status property is this |
| `--under <folder>` | only notes in this folder |
| `--where <key=value\|key>` | filter on any frontmatter property; may repeat; a bare key means present |
| `-F, --fixed-strings` | match the pattern as literal text |
| `-C, --context <n>` | lines either side (get --around: 5 by default) |

With `--json`: hits: `path`, `line`, `text`, and with `-C` the `before` and `after` lines.

```sh
neiro grep -F "working memory" -C 2
```

### find

`neiro find <query...>`

Fuzzy match over paths, titles, and aliases, ranked as fzf ranks.

| Option | Meaning |
| --- | --- |
| `--type <type>` | only notes whose type property is this |
| `--tag <tag>` | a tag, may repeat: capture and new add it; elsewhere every tag must match, case-insensitively, and area matches area/sub |
| `--status <status>` | only notes whose status property is this |
| `--under <folder>` | only notes in this folder |
| `--where <key=value\|key>` | filter on any frontmatter property; may repeat; a bare key means present |
| `--limit <n>` | most results |
| `--fields <a,b,...>` | only these fields: summary fields such as score, or any frontmatter key |

With `--json`: suggestions: the summary fields plus `score` and the `matched` path, title, or alias.

```sh
neiro find cogload --json
```

### list

`neiro list`

Notes matching the filters, optionally sorted.

| Option | Meaning |
| --- | --- |
| `--type <type>` | only notes whose type property is this |
| `--tag <tag>` | a tag, may repeat: capture and new add it; elsewhere every tag must match, case-insensitively, and area matches area/sub |
| `--status <status>` | only notes whose status property is this |
| `--under <folder>` | only notes in this folder |
| `--where <key=value\|key>` | filter on any frontmatter property; may repeat; a bare key means present |
| `--sort <modified\|created\|title\|path>` | order; notes without the value sort last |
| `--desc` | sort descending |
| `--limit <n>` | most results |
| `--fields <a,b,...>` | only these fields: summary fields such as score, or any frontmatter key |

With `--json`: summaries.

```sh
neiro list --tag psychology --sort modified --desc --limit 10
```

### tags

`neiro tags`

Every tag with its note count, parents of nested tags included.

| Option | Meaning |
| --- | --- |
| `--type <type>` | only notes whose type property is this |
| `--tag <tag>` | a tag, may repeat: capture and new add it; elsewhere every tag must match, case-insensitively, and area matches area/sub |
| `--status <status>` | only notes whose status property is this |
| `--under <folder>` | only notes in this folder |
| `--where <key=value\|key>` | filter on any frontmatter property; may repeat; a bare key means present |

With `--json`: `tag` and `notes`, the count, most used first.

```sh
neiro tags --json
```

### nav

`neiro nav [folder]`

A folder's index note and headings, subfolders, and notes.

| Option | Meaning |
| --- | --- |
| `--fields <a,b,...>` | only these fields: summary fields such as score, or any frontmatter key |

With `--json`: `folder`, its `index` note with `headings`, `folders` with note counts, and `notes`.

```sh
neiro nav Topics
```

### links

`neiro links <note>`

A note's outgoing links and how each resolves.

With `--json`: links: `target`, `display`, `embed`, and `resolution`, whose `status` is `resolved` (with `path`), `missing`, `ambiguous` (with `candidates`), or `asset`.

```sh
neiro links "Cognitive load" --json
```

### backlinks

`neiro backlinks <note>`

Notes that link to a note.

| Option | Meaning |
| --- | --- |
| `--fields <a,b,...>` | only these fields: summary fields such as score, or any frontmatter key |

With `--json`: summaries.

```sh
neiro backlinks "Cognitive load"
```

### unresolved

`neiro unresolved`

Links pointing at no note, or at several.

With `--json`: `from`, `target`, and `resolution`.

```sh
neiro unresolved --json
```

### orphans

`neiro orphans`

Notes no other note links to or embeds.

| Option | Meaning |
| --- | --- |
| `--type <type>` | only notes whose type property is this |
| `--tag <tag>` | a tag, may repeat: capture and new add it; elsewhere every tag must match, case-insensitively, and area matches area/sub |
| `--status <status>` | only notes whose status property is this |
| `--under <folder>` | only notes in this folder |
| `--where <key=value\|key>` | filter on any frontmatter property; may repeat; a bare key means present |
| `--fields <a,b,...>` | only these fields: summary fields such as score, or any frontmatter key |

With `--json`: summaries.

```sh
neiro orphans --under Topics
```

### outline

`neiro outline <note>`

A note's headings with their line numbers.

With `--json`: headings: `level`, `text`, and `line`.

```sh
neiro outline "Cognitive load"
```

### prop get

`neiro prop get <note> <key>`

One frontmatter value.

With `--json`: the value as YAML parsed it.

```sh
neiro prop get "Cognitive load" tags --json
```

### journal

`neiro journal <day|week|month|quarter|year>`

The periodic note for a date, from the vault's journal settings.

| Option | Meaning |
| --- | --- |
| `--date <YYYY-MM-DD>` | the date whose note to use (default: today) |

With `--json`: `path`, and `note` as `get` returns it, or `null` when not written yet.

```sh
neiro journal day --date 2026-09-16
```

### history

`neiro history <note>`

A note's revisions through Git, newest first (default: 20).

| Option | Meaning |
| --- | --- |
| `--limit <n>` | most results |

With `--json`: revisions: `rev`, `date`, `author`, and `message`.

```sh
neiro history "Cognitive load" --limit 5
```

### show

`neiro show <note>`

A note's content at a Git revision.

| Option | Meaning |
| --- | --- |
| `--rev <rev>` | a Git revision |

With `--json`: `path`, `rev`, and `content`.

```sh
neiro show "Cognitive load" --rev HEAD~1
```

### diff

`neiro diff <note>`

A note's changes since --rev (default: HEAD), or between --rev and --to.

| Option | Meaning |
| --- | --- |
| `--rev <rev>` | a Git revision |
| `--to <rev>` | the revision to diff to (default: the working file) |

With `--json`: `path`, `from`, `to`, and the unified `diff`.

```sh
neiro diff "Cognitive load"
```

### tools

`neiro tools`

The agent tool definitions: names, exposure, JSON Schemas, and read-only or destructive hints.

With `--json`: definitions: `name`, `description`, `inputSchema`, `annotations`, and `exposure`.

```sh
neiro tools --json
```

### help

`neiro help [command]`

This usage, one command's help, or every command as JSON with --json.

With `--json`: `version`, the `global` options, and `commands` with their `options` and `example`.

```sh
neiro help get
```

## writes

Every edit takes `--dry-run` for a unified diff, `--if-hash` to refuse a note changed since `get` returned that hash, and `--commit` for one commit of that note alone. `capture` and `new` only create notes.

### capture

`neiro capture [text...]`

Create a new note in the capture folder from text, --file, or stdin; never edits a note.

| Option | Meaning |
| --- | --- |
| `--title <title>` | the note's title (default: the first line of text) |
| `--source <url>` | where the note came from |
| `--tag <tag>` | a tag, may repeat: capture and new add it; elsewhere every tag must match, case-insensitively, and area matches area/sub |
| `--file <path>` | read the note from a Markdown file |
| `--dry-run` | show the result, a diff for edits, without writing |
| `--commit` | commit the note, and only it |
| `--push` | pull --rebase first, then commit and push |
| `--author <"Name <email>">` | commit author |

With `--json`: `path`, `content`, `written`, `committed`, and `pushed`.

```sh
neiro capture --tag reading --source https://example.com "Read: how agents plan" --dry-run
```

### new

`neiro new <type> <title...>`

Create a note from the vault's template for type, placed as capture places it.

| Option | Meaning |
| --- | --- |
| `--tag <tag>` | a tag, may repeat: capture and new add it; elsewhere every tag must match, case-insensitively, and area matches area/sub |
| `--dry-run` | show the result, a diff for edits, without writing |
| `--commit` | commit the note, and only it |
| `--push` | pull --rebase first, then commit and push |
| `--author <"Name <email>">` | commit author |

With `--json`: as `capture`.

```sh
neiro new Book The Pragmatic Programmer --dry-run
```

### append

`neiro append <note> [text...]`

Add text at the end of a note, or at the end of section --heading.

| Option | Meaning |
| --- | --- |
| `--heading <heading>` | the section, by heading text |
| `--create-heading` | add a missing heading at the end of the note instead of refusing |
| `--level <1-6>` | the level of a created heading (default: 2) |
| `--dry-run` | show the result, a diff for edits, without writing |
| `--if-hash <sha256>` | refuse unless the note still has the hash get returned |
| `--commit` | commit the note, and only it |
| `--author <"Name <email>">` | commit author |

With `--json`: a write result: `path`, the unified `diff`, `written`, `committed`, `created`, and the new `hash`.

```sh
neiro append Home "- a new line" --heading "start here" --dry-run
```

### section put

`neiro section put <note> [text...]`

Replace the body of section --heading, or add the section.

| Option | Meaning |
| --- | --- |
| `--heading <heading>` | the section, by heading text |
| `--level <1-6>` | the level of a created heading (default: 2) |
| `--dry-run` | show the result, a diff for edits, without writing |
| `--if-hash <sha256>` | refuse unless the note still has the hash get returned |
| `--commit` | commit the note, and only it |
| `--author <"Name <email>">` | commit author |

With `--json`: a write result, as `append`.

```sh
neiro section put Home "Fresh text." --heading reading --dry-run
```

### prop set

`neiro prop set <note> <key> <value>`

Set one frontmatter key, the value read as YAML, keeping comments and order.

| Option | Meaning |
| --- | --- |
| `--dry-run` | show the result, a diff for edits, without writing |
| `--if-hash <sha256>` | refuse unless the note still has the hash get returned |
| `--commit` | commit the note, and only it |
| `--author <"Name <email>">` | commit author |

With `--json`: a write result, as `append`.

```sh
neiro prop set "Cognitive load" rating 4 --dry-run
```

### put

`neiro put <path> [text...]`

Create a note, or replace one only with --if-hash (text, --file, or stdin).

| Option | Meaning |
| --- | --- |
| `--file <path>` | read the note from a Markdown file |
| `--dry-run` | show the result, a diff for edits, without writing |
| `--if-hash <sha256>` | refuse unless the note still has the hash get returned |
| `--commit` | commit the note, and only it |
| `--author <"Name <email>">` | commit author |

With `--json`: a write result, as `append`.

```sh
neiro put "Inbox/Fresh.md" "A whole new note." --dry-run
```

### journal append

`neiro journal append <day|week|month|quarter|year> [text...]`

Append to the periodic note for --date, which must exist.

| Option | Meaning |
| --- | --- |
| `--date <YYYY-MM-DD>` | the date whose note to use (default: today) |
| `--heading <heading>` | the section, by heading text |
| `--create-heading` | add a missing heading at the end of the note instead of refusing |
| `--level <1-6>` | the level of a created heading (default: 2) |
| `--dry-run` | show the result, a diff for edits, without writing |
| `--if-hash <sha256>` | refuse unless the note still has the hash get returned |
| `--commit` | commit the note, and only it |
| `--author <"Name <email>">` | commit author |

With `--json`: a write result, as `append`.

```sh
neiro journal append day "- a line for the day" --date 2026-09-16 --dry-run
```
