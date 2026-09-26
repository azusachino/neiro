# 0017 no journal in the SDK

Status: accepted, 2026-09-26 (0.8.0). Supersedes the journal paths of [ADR 0004](0004-assume-no-layout-or-house-style.md) and [ADR 0011](0011-settings-from-neiro-toml-only.md).

## context

Journals came from the first vault neiro served: a daily note, weekly and monthly notes, found by a folder and a moment-style date format per period, as Obsidian's Daily Notes and the Periodic Notes plugin name them. tsuzuri grew `[journal.<period>]` settings for five periods, `journalFor` and `appendJournal` on the `Vault`, `journal` and `journal append` in the CLI, and two agent tools, with week numbering in two conventions to match the plugin.

A periodic note is one vault's way of naming files by date, not a property of Markdown folders. With the SDK able to read and write any path ([ADR 0016](0016-the-sdk-reads-and-writes-the-whole-vault.md)), a caller that keeps journals turns a date into a path in a few lines and reads or appends to that note like any other.

## decision

tsuzuri has no journal. Removed: the `[journal.<period>]` settings, `Vault.journalFor` and `Vault.appendJournal`, `Period`, `PERIODS`, and `parseDate` from the prelude, the `journal` and `journal append` commands, and the `tsuzuri_journal` and `tsuzuri_journal_append` tools. Reading a `[journal]` table raises `ConfigError` saying that journals are the caller's. The moment-style date tokens stay only as far as templates' `{{date:FORMAT}}` needs them.

## alternatives considered

- **Keep journals as an optional feature**: rejected; it keeps five periods of settings, two week conventions, and four surfaces for one vault's naming scheme.
- **Keep a date-to-path helper in the prelude**: rejected by the owner; a caller that wants periodic notes owns the scheme.

## consequences

The settings, the CLI, the prelude, and the agent tools each get smaller. A caller that used journals computes the path and calls `get`, `append`, or a create: luna's `tsuzuri_journal` tool moves into luna. A vault's `tsuzuri.toml` with `[journal]` tables must drop them. This is a breaking change to the SDK, the CLI, and the agent tools.
