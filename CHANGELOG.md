# Changelog

## 0.3.0

- A `History` interface with `GitHistory` through the git CLI; `history`, `show --rev`, and `diff` read a note's revisions. Without Git, history raises `UnsupportedError` and every read still works; `capture --commit` then fails before writing.
- Targeted writes: `append` (to a note or a section), `journal append`, `section put`, `prop set` (comments and key order kept), `put` (create, or replace only with `--if-hash`), and `new` from the vault's templates.
- Every write previews with `--dry-run` as a unified diff, refuses a stale `--if-hash`, changes only its target range, and commits that note alone with `--commit`. Nothing deletes.
- Bullets and negative numbers on the command line are text, not options. Emoji tags are valid.

## 0.2.0

- The SDK runs on Bun and Node. Bun-only APIs sit behind fallback chains (TOML, then YAML frontmatter with `Bun.YAML` first) whose providers return identical results.
- Every command that returns notes returns one summary (path, title, type, status, tags, created, modified), with `--fields` and `--format paths`.
- New reads: `get --lines` and `get --around` (which takes an `rg -n` result), `grep`, fuzzy `find` (a failed `get` names the closest notes), `tags`, `orphans`, `outline`, and `prop get`.
- Filters: `--where` on any frontmatter property, several `--tag` flags with Obsidian's tag semantics, and `list --sort`, `--desc`, and `--limit`.
- Scans honor the vault's `.gitignore`.
- `created` and `modified` default to the date format `YYYY-MM-DD`, Obsidian's Date property.

## 0.1.0

- Reads: `get`, `search`, `list`, `nav`, `links`, `backlinks`, `unresolved`, and `journal` for day, week, month, quarter, and year, as a Bun SDK and a compiled CLI.
- `capture` creates one new note from text, stdin, or a Markdown file, keeping the file's properties, and can commit and push only that file.
- Settings come from code options, then `neiro.toml`, then the vault's Obsidian settings (new-note location, Daily Notes, Periodic Notes), then neutral defaults. No folder layout or house style is assumed.
- Tests run against a synthetic fixture and the public kepano-obsidian vault, with Obsidian's help vault as an opt-in corpus.
