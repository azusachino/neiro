# 0016 the SDK reads and writes the whole vault; policy belongs to the host

Status: accepted, 2026-09-26 (0.8.0). Supersedes [ADR 0005](0005-the-write-model.md), except its guards, and the exposure of [ADR 0010](0010-agent-tools-as-an-extension-package.md).

## context

ADR 0005 limited what tsuzuri could write: capture only creates in the capture folder, an edit targets one heading or key, replacing a whole note needs a matching hash, nothing deletes, and a new write verb needs the owner's agreement. The agent tools added a second limit, an exposure per tool (`direct`, `confirm`, `cli-only`) with a default set by tsuzuri.

Both are policy, and the policy belongs to whoever runs tsuzuri. The one agent host, luna, already replaces every default exposure with its own list, because it shares the owner's checkout and allows itself less than tsuzuri's default. A terminal user or a script has no reason to be held to an agent's limits, and an SDK that cannot move, delete, or write a file outside one folder sends its callers around it to `node:fs`, where they lose link resolution, the scan, and the guards.

## decision

- **The SDK can do anything to the vault's files** that a person in Obsidian can: create a note at any path, replace a whole note, edit a section or a property, move or rename a note, and delete one.
- **Move rewrites links.** Moving or renaming a note rewrites the wikilinks, Markdown links, and frontmatter links that resolve to it, as Obsidian does with "Automatically update internal links", so the move never leaves links unresolved.
- **Delete moves to the trash.** A deleted note goes to the vault's `.trash` folder, as Obsidian's "Move to Obsidian trash" does, so it can be restored; reads already skip dot folders.
- **The guards stay, as options.** `dryRun` returns a unified diff of every file a write would change, and `ifHash` refuses a note that changed since it was read. Neither is required: replacing a note without `ifHash` is allowed. Every write still replaces its file whole through a rename.
- **No permission layer.** tsuzuri does not decide which operations a caller may use. The agent tools describe each tool with facts, such as MCP's read-only and destructive hints, and drop `Exposure` and `DEFAULT_EXPOSURE`; the host chooses which tools to offer and which to confirm.
- `capture` and `new` stay, as conveniences that choose a path and fill a template; they are no longer the only way to create a note.

## alternatives considered

- **Keep ADR 0005's limits and add verbs one by one with the owner's agreement**: rejected; the limits suited one agent host and constrain every other caller.
- **Keep a default exposure as a suggestion**: rejected; a default in tsuzuri is still tsuzuri's policy, and the one host overrides it anyway.
- **Delete files outright**: rejected; the trash matches Obsidian and makes a mistaken delete recoverable.
- **Move without rewriting links**: rejected; it leaves the vault with unresolved links that the caller must find and fix.

## consequences

A caller can do any file operation through tsuzuri with its resolution, scan, and guards. An agent host must choose its own tool list and confirmations, as luna already does; one that relied on `DEFAULT_EXPOSURE` breaks and must list its tools. A move can change many notes at once, and its dry run shows every one. This is a breaking change to the agent tools.
