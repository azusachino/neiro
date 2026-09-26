# 0021 scope derived paths and extension operations honestly

Status: accepted, 2026-09-26 (0.8.0). Amends the mask of [ADR 0018](0018-operations-and-a-permission-mask.md) and its extension support in [ADR 0019](0019-a-small-core-and-vault-extensions.md).

## context

ADR 0018 said that a scoped delete checks every path it touches, including its `.trash` destination. The implementation and tests of [#105](https://github.com/azusachino/tsuzuri/issues/105) instead let a host delete a note under `Inbox` and move it to `.trash/Inbox` without granting access to `.trash`. That lets a host restrict which notes an agent may delete while keeping deletion recoverable.

An extension operation may also receive an `under` rule, but `Vault.run` knows only its operation name. It cannot know which paths the extension will use until the extension calls the public `Vault` methods. If those methods have broader rules, the extension's own folder scope silently has no effect.

## decision

- **A scoped delete checks the source note.** Its fixed destination, `.trash/<source>.<timestamp>`, is an exception to the folder scope; it is part of the authorized deletion of that note. No caller chooses another trash path. Other write operations check their declared vault paths; move checks both paths and every rewritten note.
- **An extension operation cannot itself have an `under` rule.** `Vault.open` and `new Vault` reject one with `ConfigError`, including a scoped kind rule that would include an extension operation. A host allows the extension operation by name or kind without a folder, then scopes the core `Vault` methods it calls. For example, `allow: ["journal", { ops: ["get"], under: ["Inbox"] }]` cannot read a journal outside `Inbox`.
- A trusted vault module is executable code, not a sandbox. The mask checks calls through `Vault`; trust remains a separate decision about whether to execute a vault's own module at all.

## alternatives considered

- **Require a separate `.trash` grant for scoped delete:** rejected; it makes a common `Inbox`-only delete unusable even though the destination is fixed by tsuzuri and derived from the authorized source.
- **Accept a scoped extension rule without checking its paths:** rejected; it promises a restriction that is not enforced.
- **Infer an extension's paths from its inputs:** rejected; extension inputs have no common path shape, and an extension may resolve paths while running. A future path contract could support scoped extension operations if a use case needs them.

## consequences

The delete behavior shipped in #105 remains available, and its exception is explicit. Hosts that used `under` on extension operations now get `ConfigError` and must scope the inner `Vault` operations instead. The permission mask is a contract for `Vault` calls, not a boundary around trusted JavaScript.
