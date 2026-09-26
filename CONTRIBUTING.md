# Contributing

tsuzuri is a personal project shared publicly. Issues, fixes, and honest disagreement with a design decision are welcome. Read [AGENTS.md](AGENTS.md) and the [roadmap](docs/roadmap.md) first: most non-obvious choices are recorded there with their reasons, and a pull request that contradicts one should say so rather than silently reverting it.

## Setup

```bash
mise install     # pins Bun, rumdl, and typos from .mise.toml
make install     # dependencies from bun.lock, plus the kepano-obsidian test vault
```

## Before opening a pull request

```bash
make check       # Biome lint and format, tsc, rumdl, typos, and tests
make validate    # check, then build the binary and run it against the fixture vault
```

CI runs `make validate` on every push and pull request; a red run blocks merge. `make format` applies Biome and rumdl formatting. `make corpus` fetches the large opt-in `obsidian-help` vault, which the test suite then includes.

## Tests

- Contract tests live in `packages/tests` and import only `tsuzuri` and `tsuzuri/tools`, as a consumer would. Unit tests of internals sit beside their code in `packages/core/src/*.test.ts`, with their own temporary files rather than the fixture vault.
- `packages/tests/fixtures/vault` is a small synthetic vault for edge cases. Never copy real personal notes into it.
- `packages/tests/vaults/` holds real public Obsidian vaults, pinned as submodules. Their tests assert invariants any correct reader must hold rather than exact counts.
- Behaviour that depends on a vault's own conventions is tested through `tsuzuri.toml` or `VaultOptions.config`, never built in as a default.

## Code style

- Biome formats and lints TypeScript and JSON; rumdl formats and lints Markdown. Do not hand-format around them.
- Comments explain a non-obvious why, never restate what the code does.
- New code uses standard `node:` modules that both Bun and Node provide. A Bun-only API belongs in a provider of a [fallback chain](docs/roadmap.md#capabilities-and-fallback-chains).
- Add a dependency only when it has released within the past year, has few or no dependencies of its own, and does something hard to get right.

## Releasing

1. Update `CHANGELOG.md` and the `version` in `packages/core/package.json`, and merge.
2. Tag the merge commit `v<version>` and push the tag.
3. `make publish`, which packs `tsuzuri-<version>.tgz` into `dist/pack` and publishes it to npm; it needs `npm login` as the package owner.
4. `gh release create v<version> dist/pack/*.tgz --notes-file <the version's changelog section>`.

Consumers install from npm, as the [README](README.md#installing) shows. A Git dependency on the repository does not work: it installs the workspace root, not the package.

## Reporting a security issue

See [SECURITY.md](SECURITY.md). Do not open a public issue for a real vulnerability.
