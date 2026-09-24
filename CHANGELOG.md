# Changelog

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
