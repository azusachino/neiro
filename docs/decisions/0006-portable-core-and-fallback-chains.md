# 0006 a portable core, with fallback chains for runtime speed-ups

Status: accepted, 2026-09-24 (0.2.0); recorded 2026-09-25.

## context

neiro started on Bun and called eight Bun-only APIs. Its first consumer, a bot, could run on Bun or Node, and a library that only runs on one runtime limits every consumer. Some Bun APIs are much faster: `Bun.YAML` parsed the first vault's frontmatter about four times faster than the `yaml` package, most of a cold load (issues #2 and #3).

## decision

The SDK runs on Bun and Node, on macOS and Linux, through standard `node:` modules and Web APIs; Windows is best-effort, with paths POSIX inside neiro. A runtime-specific speed-up sits behind a fallback chain in `packages/core/src/providers.ts`, the only place a Bun-only API may appear: each capability lists providers in order, the first available one serves the call, and each must return exactly what the portable provider returns. A speed-up that changes results is a bug. When no provider is available, neiro raises `UnsupportedError` naming the capability and what is missing.

Chains exist for YAML (`Bun.YAML`, then `yaml`, with blocks where they disagree sent to `yaml`) and TOML (`Bun.TOML`, then `smol-toml`). A capability gets a chain only when a measurement shows the fast path matters.

## alternatives considered

- **Bun only**: the 0.1.0 state, rejected to let the SDK run where its consumers do.
- **A chain for listing files** through `Bun.Glob`: measured and dropped; a `node:fs` walk returned the same paths two to three times faster.
- **An `rg -l` prefilter for grep**: measured and dropped; the in-process scan of loaded notes took 12 ms against 34 ms, and ripgrep's regex and ignore rules would drop files neiro matches.

## consequences

Tests force each provider in turn and require identical output, a guard keeps Bun-only calls inside the providers, and CI runs the read commands on Node against Bun's output. Using a new Bun API costs a portable provider and an equivalence test.
