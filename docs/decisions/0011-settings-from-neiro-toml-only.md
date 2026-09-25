# 0011 settings from neiro.toml only

Status: accepted, 2026-09-25 (0.6.0). Supersedes the Obsidian settings source of [ADR 0004](0004-assume-no-layout-or-house-style.md).

## context

Since 0.1.0 the settings chain had four sources: code options, `neiro.toml`, the vault's own Obsidian settings in `.obsidian/`, and neutral defaults. neiro read four Obsidian files for it: `app.json` for the capture folder, `daily-notes.json` and the Periodic Notes plugin's `data.json` for journal paths, and `templates.json` for the templates folder. The last of these is a plugin's private format, which a plugin update can change without notice.

An Obsidian-compatible vault needs none of these files: its links, tags, frontmatter, and titles are all in the Markdown, and reads use nothing else. The vault neiro is built for has a `neiro.toml` and no `.obsidian/` folder at all, and the only thing the fallback bought was not writing a `neiro.toml`.

## decision

Settings resolve from options passed in code, then `neiro.toml` at the vault root, then neutral defaults. neiro reads nothing in `.obsidian/`. Without a setting, capture writes at the vault root, and `journal` and `new` raise `UnsupportedError` naming the `neiro.toml` key to set. The neutral defaults for a template's `{{date}}` and `{{time}}` stay Obsidian's own, `YYYY-MM-DD` and `HH:mm`.

"Obsidian-compatible" means the files' semantics, as [ADR 0003](0003-obsidian-semantics-without-the-app.md) states them, not Obsidian's app configuration.

## alternatives considered

- **Keep reading `.obsidian/`**: zero configuration for a vault edited in Obsidian, at the cost of four readers, one of them for a plugin's private format, and a second place where a setting might come from.
- **Read only Obsidian's core settings** (`app.json`, `daily-notes.json`, `templates.json`) and drop the plugin's: rejected for the same reasons at smaller scale; weekly and monthly journals would still need `neiro.toml`.

## consequences

A vault edited in Obsidian that relied on the fallback needs its conventions written once in `neiro.toml`. There is one file source to read, test, and document, and nothing depends on Obsidian's or a plugin's configuration formats. This is a breaking change for such a vault.
