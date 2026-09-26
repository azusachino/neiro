# 0014 note types from templates, and a smaller tsuzuri.toml

Status: accepted, 2026-09-26 (0.8.0). Supersedes the capture keys of [ADR 0004](0004-assume-no-layout-or-house-style.md) and [ADR 0011](0011-settings-from-neiro-toml-only.md); the settings chain and `tsuzuri.toml` as the one file stay.

## context

`tsuzuri.toml` grew a key for each convention one vault needed: `properties` and `[capture.values]` for frontmatter, `timestamp_format`, `title_style` with a `title_allowlist` that points at a second file, `tag_style`, `require_tags`, and `reject_tags`. The owner found it too complex, and its names unclear. `properties` and `[capture.values]` only make sense together, and together they describe what a template's frontmatter would show at a glance. A template's own `title:` was dropped unless `properties` listed it.

The tools compared in the 0.8.0 research put per-type formats in template files: zk in `.zk/templates/`, Foam in `.foam/templates/` with frontmatter, Obsidian's own Templates plugin, which `new` already follows. basic-memory adds a schema language, Picoschema, with its own parser and validator. tsuzuri is mainly used by agents, which do best with a few general tools and conventions they can read in plain files, not a language to learn.

## decision

- **A note type is a template file.** `templates/<type>.md` holds the frontmatter and headings a note of that type starts with, in plain Markdown. `capture` writes the `capture` type, from `templates/capture.md` when it exists. Templates fill logic-free placeholders only: `{{title}}`, `{{date}}`, `{{time}}`, `{{date:FORMAT}}`, and `{{slug}}`. There are no conditions, loops, or scripts.
- **`tsuzuri.toml` only routes and checks.** A type may set its `folder` and `filename` pattern, which uses the same placeholders. Two small rule blocks stay, because a template cannot state a vault-wide rule: `[tags]` (`style`, `require`, `reject`) and `[titles]` (`case`, `keep`, a list written inline).
- **Removed:** `properties`, `[capture.values]`, and `timestamp_format`, which a template states directly, and `title_allowlist`, which becomes `[titles] keep`. Reading a removed key raises `ConfigError` that names where its setting now belongs.
- **Self-description:** `tsuzuri types` lists the types and their templates, `tsuzuri check <note>` reports which of its type's frontmatter keys and rules a note fails, `tsuzuri config` prints each effective setting and its source, and `tsuzuri init` writes a commented starter `tsuzuri.toml`.

## alternatives considered

- **A schema language**, as basic-memory's Picoschema: rejected; it is a grammar every user and agent must learn, with its own parser and validator, to state what a template file already shows.
- **Keep the keys and rename them**: rejected; it keeps two sources of truth, the keys and any template, that must agree.
- **Template-owned routing**, as Foam's `foam_template.filepath` in the template's frontmatter: not chosen; the folder and file name are the vault's layout, which belongs in the one config file, not scattered across templates.

## consequences

A vault's conventions are files a person or an agent can open and copy. Existing `tsuzuri.toml` files with the removed keys fail with a message saying what to change; the known vault that uses them moves its `properties` and `[capture.values]` into `templates/capture.md`. The house-style checks survive as two named blocks, which `check` can report on.
