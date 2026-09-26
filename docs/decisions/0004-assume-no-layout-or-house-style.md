# 0004 assume no layout or house style

Status: accepted, 2026-09-24 (0.1.0); recorded 2026-09-25. Its Obsidian settings source is superseded by [ADR 0011](0011-settings-from-neiro-toml-only.md). Its capture keys are superseded by [ADR 0014](0014-note-types-from-templates.md).

## context

The first version of neiro wrote captures in one vault's conventions: its inbox folder, frontmatter fields, file naming, and journal paths. Those conventions belonged to one owner, and a public tool that assumed them would impose them on everyone else, or break on any vault laid out differently. Commit 9bb6e13 rebuilt the fixture as a neutral Obsidian vault and moved every convention into settings.

## decision

neiro assumes no folder layout or house style. Folders, frontmatter fields and their order, file naming, title and tag rules, journal paths, and the template folder resolve in order from options passed in code, then `neiro.toml` at the vault root, then the vault's own Obsidian settings, then a neutral default. A default is Obsidian's own behaviour, never one vault's convention; where Obsidian has no default, as for journal paths, neiro raises `UnsupportedError` naming what to set. An unknown key or a wrong value in `neiro.toml` or code options raises `ConfigError` (0.5.0).

Tests use a synthetic fixture and public vaults, never a personal vault or text copied from one; a vault-specific behaviour is tested through code options.

## alternatives considered

- **Built-in defaults from the first vault**: the 0.1.0 starting point, rejected because a default must be neutral.
- **Guessing a layout** when a setting is missing, such as a `Daily/` folder: rejected in favour of `UnsupportedError`, so a vault is never written to a path it did not ask for.
- **Ignoring unknown settings keys**: the behaviour until 0.5.0, replaced because a misspelled key silently had no effect.

## consequences

Any Obsidian vault works without configuration for reads, and one `neiro.toml` states a stricter house style. A vault with no journal settings cannot use journal commands until it declares them. Every new convention-shaped feature needs a setting and a neutral default before it ships.
