# 0018 operations, and a permission mask the host sets

Status: accepted, 2026-09-26 (0.8.0). Amends the "no permission layer" rule of [ADR 0016](0016-the-sdk-reads-and-writes-the-whole-vault.md). Its table is opened to extensions by [ADR 0019](0019-a-small-core-and-vault-extensions.md).

## context

ADR 0016 gave the SDK every file operation and left policy to the host, with no permission layer in tsuzuri. A host still has to enforce its policy somewhere. luna does it by keeping its own list of tool names, which covers the agent tools but not a direct SDK call, has to be kept in step with each new tool, and cannot say "create notes only in the inbox". Each new verb from ADR 0016 widens what such a hand-kept list has to cover.

## decision

- **Every vault operation is named, with a kind.** One table in the prelude lists each operation and its kind: `read`, `create`, `edit`, `move`, or `delete`. For example, `get` and `search` are reads, `capture` and `write` create, `append`, `setProperty`, and `put` edit. The SDK methods, the CLI commands, and the agent tools are defined from that table, so a new verb is added in one place and has a kind from the start.
- **A mask allows operations, optionally within folders.** A `Vault` opened with `allow` accepts a list of rules; each rule names kinds or operations, and may limit them to folders: `allow: ["read", "capture", { ops: ["edit"], under: ["Inbox"] }]`. With no `allow`, everything is allowed; tsuzuri ships no policy of its own.
- **The mask is a guarantee about files.** A masked `Vault` never changes a file its rules do not allow: an operation is checked against every path it would touch before it touches any, and raises `PermissionError` otherwise. A move needs its rule for both the old and the new path, and the notes whose links it rewrites count as edits that the mask must allow; a delete's move into `.trash` is part of the delete. A read rule limited to folders makes the notes outside them invisible to every read, including search, links, and backlinks.
- **The agent tools follow the mask.** `agentTools()` offers only the operations the vault allows; the hints stay facts.

## alternatives considered

- **No mask; each host filters**: rejected; a host could still call a masked operation directly, and every host would rebuild the same list.
- **Mask by kind only**: rejected; a host that allows `capture` must not thereby allow creating a note at any path, and both are `create`.
- **Mask by operation only, without folders**: rejected by the owner; "create or edit only in the inbox" is the common rule for an agent sharing a vault.
- **A default mask in tsuzuri**: rejected, as in ADR 0016; the mask is a mechanism, and its settings are the host's.

## consequences

A host states its policy in one value, and it holds for SDK calls, CLI commands, and tools alike. Every operation checks its paths against the mask, which costs a lookup per path. A move can be refused because one note linking to its target lies outside the mask. The operations table becomes part of the prelude contract.
