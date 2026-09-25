# 0003 Obsidian semantics without the Obsidian app

Status: accepted, 2026-09-24 (0.1.0); recorded 2026-09-25. Its settings bullet is superseded by [ADR 0011](0011-settings-from-neiro-toml-only.md).

## context

The vault is edited in Obsidian and must also be read by a bot running in a container with no GUI. Obsidian's own CLI and its plugins need the app running; LiveSync and Obsidian Sync need their services. A tool that reads the files still has to agree with Obsidian about what the files mean, or links, tags, and titles would resolve differently in the two.

## decision

neiro behaves as Obsidian defines vault behaviour, and never requires the Obsidian app, a plugin, or Obsidian Sync to run:

- Wikilinks resolve as Obsidian resolves them: a vault-root path, a path relative to the linking note, a unique path suffix, then a unique file name, preferring the linking note's folder. A link that still matches several notes is reported as ambiguous, not guessed. Wikilinks in frontmatter values and Markdown links to vault files count as links, as they do in Obsidian.
- Tags match case-insensitively, and a nested tag `area/sub` matches `area`.
- A note without a `title` property takes its file name as its title.
- Settings come from the vault's own `.obsidian/` files where Obsidian has them (see [ADR 0004](0004-assume-no-layout-or-house-style.md)).

Where neiro cannot confirm Obsidian's behaviour without the app, the question stays open rather than decided by guess, as issue #24 is for a bare alias link.

## alternatives considered

- **Drive the Obsidian app** through its CLI or a plugin: rejected because the bot has no GUI.
- **Obsidian's sync services** as the transport: rejected for the same reason, and because they tie the vault to a service.
- **neiro's own link and tag rules**: not recorded as considered; they would make the same vault mean different things in Obsidian and in neiro.

## consequences

The vault works the same in Obsidian and in neiro, and neiro runs anywhere a file system does. neiro has to track Obsidian's behaviour itself, and corpus tests against public Obsidian vaults assert invariants rather than exact counts, since only the app is the final authority.
