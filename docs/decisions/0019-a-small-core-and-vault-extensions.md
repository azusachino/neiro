# 0019 a small core, and extensions a vault defines

Status: accepted, 2026-09-26 (0.8.0). Extends [ADR 0009](0009-the-core-contract-and-prelude.md)'s layers and [ADR 0018](0018-operations-and-a-permission-mask.md)'s operations table; refines where [ADR 0017](0017-no-journal-in-the-sdk.md) sends journals. Its journal-as-example is amended by [ADR 0020](0020-bundled-extensions-journal-first.md): tsuzuri bundles opt-in extensions, the journal first.

## context

tsuzuri serves a vault: a folder of Markdown documents with YAML frontmatter. Journals left the core because they are one vault's convention ([ADR 0017](0017-no-journal-in-the-sdk.md)), but that vault still wants them, and each of its hosts, the owner's terminal and luna, would otherwise rebuild the same operation. Note types already belong to the vault, as templates ([ADR 0014](0014-note-types-from-templates.md)). Operations should too: a vault such as Apricot should define its own, once, for every host.

The package has three layers: the core SDK, the CLI, and the agent tools. They were separate packages until [ADR 0012](0012-one-npm-package-named-tsuzuri.md) joined them to stop versioning them against each other.

## decision

- **The core knows Markdown files with YAML frontmatter, and nothing about one vault's conventions**: scanning, reading, search, links, the file operations of [ADR 0016](0016-the-sdk-reads-and-writes-the-whole-vault.md), types from templates, and the operations table with its mask.
- **One package, in layers.** `tsuzuri` is the core; `tsuzuri/extension` holds `defineOperation` and the types an extension needs; `tsuzuri/tools` and the two commands sit on top. Every layer and every extension imports only the core's public entry, as the CLI does under ADR 0009. A layer becomes its own package only when it brings heavy dependencies of its own.
- **An extension defines operations.** `defineOperation({ name, kind, input, run })` names an operation, gives its kind for the mask, describes its input, and implements it with the public SDK. A registered operation becomes a CLI command and an agent tool, and the mask covers it like a core operation. A name that clashes with a core operation or another extension raises `ConfigError`.
- **A vault lists its extensions** in `tsuzuri.toml`, as vault-relative module paths: `extensions = [".tsuzuri/journal.ts"]`. A `.js` module works on every runtime, and `.ts` where the runtime strips types, as Bun and Node 24 do.
- **Extensions run only in a trusted vault.** Loading one runs the vault's code, so the caller opts in: `new Vault(root, { trust: true })` in the SDK, and `--trust` or the vault's root in a user-level trust list for the CLI. A host may also pass extensions in code. An untrusted vault that lists extensions still opens with the core operations, and says which extensions it skipped.
- Apricot's journal is the first extension, and tsuzuri's documentation carries it as the example.

## alternatives considered

- **Separate packages for core, CLI, tools, and each extension**: rejected for now; it brings back the versioning between packages that ADR 0012 removed, for no dependency that needs it.
- **Extensions only from the host, never from the vault**: rejected; the vault owns its conventions, and each host would redo them.
- **Always load a vault's extensions**: rejected; opening a cloned or shared vault would run its code on a plain `list`.
- **A declarative language for operations**: rejected; an operation such as a journal needs a date turned into a path, which code says in a line, and ADR 0014 already rejected a schema language for types.

## consequences

A vault carries its types and its operations, and every host gets both through one mechanism, with the mask still in force. The CLI and the SDK load code from a vault when trusted, which the trust list and the skip report make visible. Extensions depend on the core's public entry, so it stays the contract they build on. luna reads Apricot's journal through Apricot's extension instead of its own tool.
