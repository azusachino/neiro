# 0010 agent tools as an extension package

Status: accepted, 2026-09-25 (0.6.0); the separate package superseded by [ADR 0012](0012-one-npm-package-named-tsuzuri.md).

## context

0.4.0 added ready-made tool definitions for tool-calling models: `agentTools()`, `TOOLS`, `DEFAULT_EXPOSURE`, and `validateInput`, each tool with a name, a JSON Schema, MCP-style hints, an exposure, and a `run` bound to the SDK; 0.5.0 added `neiro tools` to print them. They made a third surface beside the SDK and the CLI, with a contract of its own in the tool names and schemas, and a `run(vault, input, context)` whose context carried only Git policy.

neiro is an SDK and a CLI. A consumer that does not call a model should not carry tool definitions, and a tool layer that lives in core can reach internals no other consumer can.

## decision

The agent tools move into an extension package, `neiro-tools`, in `packages/tools/` of the same repository. The repository is a Bun workspace whose private root holds only tooling, with the core package, `neiro`, in `packages/core/`. It imports only the `neiro` prelude, making it neiro's first outside consumer: anything it cannot do through the public API is a gap in the SDK. `run` becomes `run(vault, input)`. It ships a `neiro-tools --json` command that prints the definitions, and the core CLI drops `neiro tools`. Both packages carry the same version and are released together; the first is 0.6.0.

The default exposure, proposed in 0.4.0 and pending the owner's agreement until now, is agreed as it stands: every read, `neiro_capture`, and `neiro_journal_append` are `direct`; `neiro_append`, `neiro_section_put`, `neiro_prop_set`, and `neiro_new` need a human's `confirm`; `neiro_put` is never offered to a model. A consumer passes its own exposure to change it.

The tool names, input schemas, hints, and default exposure are `neiro-tools`' contract, as [ADR 0009](0009-the-core-contract-and-prelude.md) defines neiro's.

## alternatives considered

- **Keep the tools in core**: rejected; it widens core's contract for consumers that never call a model.
- **A `neiro/tools` subpath** of the same package: rejected, because it still ships and versions in core.
- **A separate repository**: rejected for now; one pull request can then change an SDK method and the tool over it, and the extension's drift tests run beside the code they check.
- **No tool definitions at all**, each consumer writing its own: rejected; about 20 hand-written schemas per consumer would drift from the SDK unchecked.
- **neiro at the repository root, with the extension beneath it**: tried and rejected. Bun cannot link a workspace member to the workspace root: `workspace:*` does not resolve, and `file:../..` installs a 698 MiB copy of the repository, test vaults included, that goes stale as core changes.
- **Independent versions**: rejected; one version keeps "which neiro-tools works with this neiro" obvious.

## consequences

A consumer installs `neiro` alone, or `neiro` and `neiro-tools`. The repository gains a workspace and a second package to build and test. Moving the tools out is a breaking change for anyone importing them from `neiro`.
