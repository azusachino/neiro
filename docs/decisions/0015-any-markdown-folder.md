# 0015 any Markdown folder, Obsidian first

Status: accepted, 2026-09-26 (0.8.0). Amends the title rule of [ADR 0003](0003-obsidian-semantics-without-the-app.md).

## context

tsuzuri was built for an Obsidian vault, and ADR 0003 made Obsidian's behaviour the definition: a note without a `title` property takes its file name as its title. Run against a 10,248-page MkDocs collection with no frontmatter, tsuzuri read and searched it well, but a docs site titles a page by its first `#` heading, may name its files by number such as `01.md`, and marks a folder's landing page with `README.md` as well as `index.md`. The owner wants tsuzuri to be a tool for Markdown folders in general, with Obsidian vaults as the first case, not the only one.

## decision

- **A note's title** is its `title` property, then, for a note whose first line of content is a level-one heading, that heading, then its file name. An Obsidian note is not expected to start with a `#` heading that differs from its file name, so Obsidian vaults should keep the titles Obsidian shows; a test on a public Obsidian vault checks it.
- **A folder's index note** is `index.md` or `README.md`, as a static site generator or a forge renders them.
- Links, tags, and frontmatter keep Obsidian's rules. Reading a site generator's own configuration, such as MkDocs' `mkdocs.yml` navigation, is later work, taken up only if a use case needs it.

## alternatives considered

- **Keep Obsidian semantics only**: rejected; docs sites and plain Markdown folders would work but read poorly, and the owner wants them in scope.
- **A per-vault setting choosing the title rule**: rejected for now; the fallback order serves both kinds of folder without a setting.

## consequences

Titles in a docs site or a plain Markdown folder read as a reader would see them. A note whose first line is a `#` heading that differs from its file name now takes the heading as its title; in an Obsidian vault that is rare, and the note's file name still resolves links as before.
