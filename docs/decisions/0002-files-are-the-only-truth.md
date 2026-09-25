# 0002 files are the only truth

Status: accepted, 2026-09-24 (0.1.0); recorded 2026-09-25.

## context

neiro serves a personal vault from the terminal and from a bot that imports the SDK. Tools in this space split between two models: an indexed store that must be built and kept fresh (a search index, a database, a plugin's cache), and a tool that reads the Markdown on every call, as notesmd-cli does. The first vault neiro served has 1,837 notes and 8.3 MB of text; at 0.1.0 a full load measured about 18 ms of start-up, 10 ms to list files, 25 ms to read them, and 100 ms to parse YAML frontmatter, and a search answered in about 200 ms including start-up.

## decision

Every answer comes from the Markdown files on disk. neiro keeps no index, cache file, or database of its own. A `Vault` may hold what it scanned in memory, and may build derived structures from that scan, such as the link graph, as long as a rescan rebuilds them. An on-disk index may be added only when a measurement shows the scan is too slow, and must then be derived from the files, disposable, and rebuildable, so that deleting it loses nothing.

## alternatives considered

- **An in-memory search index** such as `minisearch` or `@orama/orama`: rejected because the scan already ranked in 17–33 ms, and CJK text would need a custom tokenizer.
- **A derived SQLite cache** keyed by path, size, and modification time: deferred, not rejected, until a cold load is measured to be too slow.
- **Local embeddings** for recall of Chinese phrases that are not literal substrings: deferred until that miss becomes a daily failure.

## consequences

Nothing drifts from the files, so there is nothing to rebuild, repair, or migrate, and a note edited by hand or by Obsidian is seen on the next scan. Every cold call pays the scan; a long-running process pays it once and again after changes, through `reload()` or `watch`. Queries that would need a precomputed structure over the whole vault, such as semantic search, wait until a measurement asks for them.
