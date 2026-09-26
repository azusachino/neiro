# cli reference

Every `tsuzuri` command, its options, and what `--json` returns. `tsuzuri help <command>` prints the same for one command, and `tsuzuri help --json` prints all of it as JSON. A test fails when this page misses a command or option the CLI declares.

## global options

| Option | Meaning |
| --- | --- |
| `--vault <dir>` | vault root (default: $TSUZURI_VAULT, then the current directory) |
| `--json` | machine-readable output and errors, the same as --format json |
| `--format <text\|json\|paths>` | paths prints one path per line, for xargs and fzf |
| `-h, --help` | show help, for one command when one is given |
| `-v, --version` | show the version |

The vault is `--vault`, else `$TSUZURI_VAULT`, else the current directory. A command refuses an option it does not take. A text argument that starts with a dash and a space, or a negative number, is text rather than an option; anything else starting with a dash goes after `--`.

## output and errors

Text output is for people. With `--json`, stdout is one JSON value, shaped as each command below says. Commands that return notes share one summary: `path`, `title`, `type`, `status`, `tags`, `created`, and `modified`, the optional ones only when set. `--fields a,b` keeps only the named fields, a summary field or any frontmatter key, `null` when absent, and `--format paths` prints one path per line.

With `--json`, a failure prints one line on stderr, `{"error": {"name", "message", ...}}`, with the error's own fields: `suggestions` on `NotFoundError`.

| Exit | Meaning |
| --- | --- |
| 0 | done |
| 1 | a request tsuzuri refused or could not serve: `NotFoundError`, `WriteConflictError`, `UnsupportedError`, `ConfigError`, and the other `TsuzuriError`s |
| 2 | bad usage: `UsageError` |

## reads

### get

`tsuzuri get <note>`

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
tsuzuri get "Working memory" --lines 1:20 --json
```

### search

`tsuzuri search <query...>`

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
tsuzuri search cognitive load --limit 5 --json
```

### grep

`tsuzuri grep <pattern>`

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
tsuzuri grep -F "working memory" -C 2
```

### find

`tsuzuri find <query...>`

Fuzzy match over paths, titles, and aliases, ranked as fzf ranks. Each word of the query must match; a CJK phrase written without spaces is split into its words, so `分布式事务` finds the same notes as `分布式 事务`.

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
tsuzuri find cogload --json
```

### list

`tsuzuri list`

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
tsuzuri list --tag psychology --sort modified --desc --limit 10
```

### tags

`tsuzuri tags`

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
tsuzuri tags --json
```

### nav

`tsuzuri nav [folder]`

A folder's index note and headings, subfolders, and notes.

| Option | Meaning |
| --- | --- |
| `--fields <a,b,...>` | only these fields: summary fields such as score, or any frontmatter key |

With `--json`: `folder`, its `index` note with `headings`, `folders` with note counts, and `notes`.

```sh
tsuzuri nav Topics
```

### links

`tsuzuri links <note>`

A note's outgoing links and how each resolves.

With `--json`: links: `target`, `display`, `embed`, and `resolution`, whose `status` is `resolved` (with `path`), `missing`, `ambiguous` (with `candidates`), or `asset`.

```sh
tsuzuri links "Cognitive load" --json
```

### backlinks

`tsuzuri backlinks <note>`

Notes that link to a note.

| Option | Meaning |
| --- | --- |
| `--fields <a,b,...>` | only these fields: summary fields such as score, or any frontmatter key |

With `--json`: summaries.

```sh
tsuzuri backlinks "Cognitive load"
```

### unresolved

`tsuzuri unresolved`

Links pointing at no note, or at several.

With `--json`: `from`, `target`, and `resolution`.

```sh
tsuzuri unresolved --json
```

### orphans

`tsuzuri orphans`

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
tsuzuri orphans --under Topics
```

### outline

`tsuzuri outline <note>`

A note's headings with their line numbers.

With `--json`: headings: `level`, `text`, and `line`.

```sh
tsuzuri outline "Cognitive load"
```

### prop get

`tsuzuri prop get <note> <key>`

One frontmatter value.

With `--json`: the value as YAML parsed it.

```sh
tsuzuri prop get "Cognitive load" tags --json
```

### help

`tsuzuri help [command]`

This usage, one command's help, or every command as JSON with --json.

With `--json`: `version`, the `global` options, and `commands` with their `operation`, `options`, and `example`; `operation` names the entry of the SDK's `OPERATIONS` a command runs.

```sh
tsuzuri help get
```

## writes

Every edit takes `--dry-run` for a unified diff, `--if-hash` to refuse a note changed since `get` returned that hash, and `capture` and `new` only create notes.

### capture

`tsuzuri capture [text...]`

Create a new note in the capture folder from text, --file, or stdin; never edits a note.

| Option | Meaning |
| --- | --- |
| `--title <title>` | the note's title (default: the first line of text) |
| `--source <url>` | where the note came from |
| `--tag <tag>` | a tag, may repeat: capture and new add it; elsewhere every tag must match, case-insensitively, and area matches area/sub |
| `--file <path>` | read the note from a Markdown file |
| `--dry-run` | show the result, a diff for edits, without writing |

With `--json`: `path`, `content`, and `written`.

```sh
tsuzuri capture --tag reading --source https://example.com "Read: how agents plan" --dry-run
```

### new

`tsuzuri new <type> <title...>`

Create a note from the vault's template for type, placed as capture places it.

| Option | Meaning |
| --- | --- |
| `--tag <tag>` | a tag, may repeat: capture and new add it; elsewhere every tag must match, case-insensitively, and area matches area/sub |
| `--dry-run` | show the result, a diff for edits, without writing |

With `--json`: as `capture`.

```sh
tsuzuri new Book The Pragmatic Programmer --dry-run
```

### append

`tsuzuri append <note> [text...]`

Add text at the end of a note, or at the end of section --heading.

| Option | Meaning |
| --- | --- |
| `--heading <heading>` | the section, by heading text |
| `--create-heading` | add a missing heading at the end of the note instead of refusing |
| `--level <1-6>` | the level of a created heading (default: 2) |
| `--dry-run` | show the result, a diff for edits, without writing |
| `--if-hash <sha256>` | refuse unless the note still has the hash get returned |

With `--json`: a write result: `path`, the unified `diff`, `written`, `created`, and the new `hash`.

```sh
tsuzuri append Home "- a new line" --heading "start here" --dry-run
```

### section put

`tsuzuri section put <note> [text...]`

Replace the body of section --heading, or add the section.

| Option | Meaning |
| --- | --- |
| `--heading <heading>` | the section, by heading text |
| `--level <1-6>` | the level of a created heading (default: 2) |
| `--dry-run` | show the result, a diff for edits, without writing |
| `--if-hash <sha256>` | refuse unless the note still has the hash get returned |

With `--json`: a write result, as `append`.

```sh
tsuzuri section put Home "Fresh text." --heading reading --dry-run
```

### prop set

`tsuzuri prop set <note> <key> <value>`

Set one frontmatter key, the value read as YAML, keeping comments and order.

| Option | Meaning |
| --- | --- |
| `--dry-run` | show the result, a diff for edits, without writing |
| `--if-hash <sha256>` | refuse unless the note still has the hash get returned |

With `--json`: a write result, as `append`.

```sh
tsuzuri prop set "Cognitive load" rating 4 --dry-run
```

### put

`tsuzuri put <path> [text...]`

Create a note, or replace one only with --if-hash (text, --file, or stdin).

| Option | Meaning |
| --- | --- |
| `--file <path>` | read the note from a Markdown file |
| `--dry-run` | show the result, a diff for edits, without writing |
| `--if-hash <sha256>` | refuse unless the note still has the hash get returned |

With `--json`: a write result, as `append`.

```sh
tsuzuri put "Inbox/Fresh.md" "A whole new note." --dry-run
```
