# 0009 the core contract and its prelude

Status: accepted, 2026-09-25 (0.6.0).

## context

By 0.5.0 the root entry exported 51 runtime names and about 30 types. Most were internals, such as `splice`, `fuzzyScore`, `writeNote`, and `isoWeek`, exported because the CLI may import only the public entry. Every export is a promise: once a consumer relies on it, removing or changing it breaks them. Agents rely as much on the CLI's flags and JSON output as a library does on exports, and 0.5.0 changed both.

## decision

**The contract.** neiro's public contract has two surfaces: the SDK's exports, and the CLI's commands, flags, exit codes, and `--json` output shapes. Help text and prose error messages may change freely. Before 1.0 the contract may still change, but every breaking change is named in the changelog.

**One note model.** Every command and method that returns notes returns the same summary (`path`, `title`, `type`, `status`, `tags`, `created`, and `modified`), so a consumer never needs a second call to learn a hit's type, tags, or dates. This has held since 0.2.0 (issue #4), when search hits gained the summary; it is part of the contract.

**The prelude.** The root `neiro` entry is the only entry in `package.json`'s `exports`, so the runtime refuses a deep import such as `neiro/src/write.ts`. It carries `Vault`; the errors, all extending `NeiroError`; the helpers the CLI needs, `captureInputFromMarkdown`, `formatGrep`, `parseDate`, and `propertyValue`, with the `PERIODS` and `SORT_KEYS` constants; and the types that `Vault`'s methods and its `settings` field use. A test snapshots the export list, so a change to the prelude is always deliberate.

**The CLI** imports only the prelude, so it can do nothing a library consumer cannot.

**Subpath entries**, such as `neiro/markdown` for frontmatter and link parsing, are added only when a consumer needs one, and each becomes part of the contract.

## alternatives considered

- **Keep exporting everything**: rejected; it freezes internals.
- **Let the CLI import internals** and keep them out of the prelude: considered, and rejected in favour of the stricter rule, at the cost of four small helpers in the prelude.
- **An unstable `neiro/internal` entry**: rejected, since an unstable label does not stop consumers depending on it.
- **Freeze only the SDK**: rejected, because the CLI's JSON is what agents consume.

## consequences

neiro can change its internals freely. A consumer who needs an internal asks for it, and it is added as a named export or a subpath. The prelude cut is a breaking change for anyone importing a removed name; nothing outside neiro did at the time.
