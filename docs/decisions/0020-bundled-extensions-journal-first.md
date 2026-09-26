# 0020 bundled extensions, the journal first

Status: accepted, 2026-09-26 (0.8.0). Amends [ADR 0019](0019-a-small-core-and-vault-extensions.md), which carried the journal as a documented example only, and [ADR 0017](0017-no-journal-in-the-sdk.md)'s refusal of `[journal]`.

## context

ADR 0017 took journals out of the core, and ADR 0019 let a vault define its own operations, with the journal as the documented example each vault would copy. Daily and periodic notes are Obsidian's most common convention, though: every vault that keeps them would carry the same code, and a copy in a vault needs the trust opt-in to run, although it came from tsuzuri.

## decision

- **tsuzuri ships extensions of its own, each opt-in.** A bundled extension is a module in the package, under `tsuzuri/extensions/<name>`, written only against the public entry and `tsuzuri/extension`, like any other. It is off until a vault lists it: `extensions = ["tsuzuri:journal"]`. The core and its default commands know nothing of it.
- **A bundled extension needs no trust.** It is tsuzuri's own code, so listing it is enough; only modules from the vault need the trust opt-in of ADR 0019.
- **The journal is the first.** It provides `journal` and `journal append` for day, week, month, quarter, and year notes, as operations with kinds, so the mask covers them. Its settings are the `[journal.<period>]` tables with `folder` and `format` that tsuzuri read before 0.8.0. With the extension listed, those tables are valid; without it, `[journal]` still raises `ConfigError`, which now names the extension to enable.
- A bundled extension joins only when it serves a convention many vaults share, as journals do; one vault's convention stays in that vault.

## alternatives considered

- **The journal as a documented example only** (ADR 0019): rejected by the owner; every journal-keeping vault would copy it and need trust to run code tsuzuri wrote.
- **Back in the core** (before ADR 0017): rejected; a vault without journals would carry the settings, commands, and tools anyway.
- **A separate `tsuzuri-journal` package**: rejected, as ADR 0019 rejected separate packages without dependencies that need one.

## consequences

A vault that kept journals before 0.8.0 adds one line to its `tsuzuri.toml` and keeps its `[journal]` tables. The package carries the journal code again, outside the core and off by default. The extension API is exercised by shipped code, not only by an example. luna gets journals by Apricot listing the extension, without trusting Apricot's own modules.
