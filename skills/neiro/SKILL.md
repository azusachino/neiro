---
name: neiro
description: neiro, the CLI for an Obsidian-compatible Markdown vault. Use when reading, searching, or navigating a vault's notes, capturing a new note into it, or changing one section, property, or journal entry of an existing note.
---

# neiro

neiro reads and writes a vault's Markdown files directly; Obsidian need not run. Run it with `--vault <dir>` or `$NEIRO_VAULT` set, and pass `--json` to every call you parse. `neiro help <command>` gives a command's options and an example; this skill covers what help cannot: which command to reach for, and how to write without clobbering the owner.

Before writing, read the vault's own instructions (`AGENTS.md` or similar at its root). They decide where new notes go, and whether you may commit; when they reserve commits for the owner, leave out `--commit` and `--push`.

## Read

Each read ends when you can name the note paths your answer rests on.

| You have | Run |
| --- | --- |
| an unfamiliar vault | `nav`, then `nav <folder>` into folders whose index headings fit |
| a question | `search <words> --limit 5`, then `get <path>` on the best hits |
| an exact phrase | `grep -F <text>`, then `get --around <path:line> --context 10` with a hit as printed |
| a loose name from a message | `get <ref>`; on a miss, the error's `suggestions`, or `find <ref>` |
| a note to place in the graph | `links <note>` and `backlinks <note>` |
| a date | `journal day\|week\|month --date YYYY-MM-DD` |

A reference is a path, file name, title, or alias. When it matches several notes, neiro refuses and names every candidate: pick one by path. Line numbers count from the top of the file, frontmatter included, as `rg -n` counts them. In a long note, read `--lines a:b` instead of the whole body.

## Write

Reach for the narrowest verb:

| To | Run |
| --- | --- |
| add a new note | `capture <text> --tag <t>`, with tags from `tags` |
| add to a note or one of its sections | `append <note> <text> [--heading H]` |
| replace one section's body | `section put <note> --heading H <text>` |
| set one frontmatter key | `prop set <note> <key> <value>` |
| add to a journal note that exists | `journal append <period> <text> [--heading H]` |
| create a note from a template | `new <type> <title>` |

`capture` and `new` only create files, so they need no hash. For every other write:

1. `get <note> --json` and keep its `hash`.
2. Run the write with `--dry-run --if-hash <hash>` and check the diff changes only what you meant.
3. Run it again without `--dry-run`. The write is done when the result shows `written: true`; its new `hash` feeds a following write.

A text argument that starts with a dash and a space is a Markdown bullet, not an option.

## Errors

With `--json`, a failure is one line on stderr, `{"error": {"name", "message", ...}}`. Act on the name:

| Name | Next |
| --- | --- |
| `NotFoundError` | retry with a path from `suggestions`, or `find` |
| `WriteConflictError` | the note changed since you read it: `get` it again and redo the write from step 1 |
| `SectionError` | the heading is missing or repeated: `outline <note>` shows the headings |
| `UnsupportedError`, `ConfigError` | the vault lacks a setting, such as a journal format; report it to the user as the message words it |
| `PartialWriteError` | the note is written but not committed or pushed; report its `path`, and leave the write as it is |
| `UsageError` | `neiro help <command>` |

Exit code 1 is a refused request and 2 is bad usage.
