# Changelog

## 0.1.0

- Reads: `get`, `search`, `list`, `nav`, `links`, `backlinks`, `unresolved`, and `journal` for day, week, month, quarter, and year, as a Bun SDK and a compiled CLI.
- `capture` creates one new note and can commit and push only that file.
- Settings come from code options, then `neiro.toml`, then the vault's Obsidian settings (new-note location, Daily Notes, Periodic Notes), then neutral defaults. No folder layout or house style is assumed.
- Tests run against a synthetic fixture and the public kepano-obsidian vault, with Obsidian's help vault as an opt-in corpus.
