# 0013 Node first, Bun as a fast path

Status: accepted, 2026-09-26 (0.8.0).

## context

tsuzuri's code already runs on Node: the published package serves built JavaScript, both commands carry a `node` shebang, and `make node-smoke` compares Node's output with Bun's byte for byte. Its development does not. Every test imports `bun:test`, sixteen files read Bun's `import.meta.dir`, fourteen spawn `bun` by name, `make pack` uses `bun pm pack`, and `make check` needs Bun installed. The package also declared `node >= 24`, though the built CLI and the whole suite pass on Node 22.

Most people who would install tsuzuri run Node, and the owner wants it to be the runtime tsuzuri is built and verified for. Running the suite on Node also found a real gap: 20 `expect(...).rejects` assertions had no `await`, which `bun test` accepts without running the assertion.

## decision

- **Node is the primary runtime.** The package supports `node >= 22`, and CI runs the whole test suite on Node 22 and 24, with Bun absent.
- **vitest is the test runner,** as a development dependency only; tests import `vitest`. It is the smallest change from `bun:test`, whose matchers it shares, and it does not reach anyone who installs tsuzuri.
- **Tests and scripts use portable APIs:** `import.meta.dirname`, `node:child_process`, and the CLI spawned with `node`. `make pack` uses `npm pack`, which runs `prepack`.
- **Bun stays a supported runtime and a fast path.** The fallback chains of [ADR 0006](0006-portable-core-and-fallback-chains.md) keep `Bun.YAML` and `Bun.TOML` as providers; their equivalence tests run when Bun is present. `make node-smoke` keeps comparing the two runtimes. The `bun` export condition, which lets Bun import the TypeScript source, stays, and CI type-checks a consumer against the built `dist/lib` so the declarations Node consumers get are checked too.

## alternatives considered

- **`node:test` and `node:assert`, with no dependency at all**: rejected for now; it rewrites about 1,200 assertions by hand across 30 files, the largest and most error-prone change, for a dependency that never ships.
- **Keep `bun test`, and test Node only through `make node-smoke`**: rejected; the unit and contract tests would still never run on the runtime most users have, and contributors would still need Bun.
- **Keep `node >= 24`**: rejected; nothing in the code needs it, and Node 22 is still a maintained LTS line.

## consequences

`make check` and CI no longer need Bun, and a contributor with only Node can work on tsuzuri. The development dependencies grow by vitest and its tree, an exception to [ADR 0007](0007-maintained-dependencies-or-own-code.md)'s bar that applies to development tooling only. Bun remains faster at scanning, about twice on a 10,000-note tree, and keeps its fast paths.
