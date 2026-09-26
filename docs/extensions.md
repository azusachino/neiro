# extensions

An extension adds operations to a vault: each becomes a CLI command, an agent tool, and an entry the permission mask covers, like tsuzuri's own ([ADR 0019](decisions/0019-a-small-core-and-vault-extensions.md)). tsuzuri's core knows Markdown files with YAML frontmatter and nothing of one vault's conventions; a convention such as periodic notes is an extension.

## enabling one

A vault lists its extensions in `tsuzuri.toml`:

```toml
extensions = ["tsuzuri:journal", ".tsuzuri/reading.js"]
```

- `tsuzuri:<name>` is an extension bundled with tsuzuri ([ADR 0020](decisions/0020-bundled-extensions-journal-first.md)). It is tsuzuri's own code, so listing it is enough.
- Any other entry is a module the vault holds, by its path from the vault root. Loading it runs the vault's code, so it loads only when the caller trusts the vault: `Vault.open(root, { trust: true })` in the SDK, and on the CLI `--trust` or the vault's root in `vaults` in `$XDG_CONFIG_HOME/tsuzuri/trust.toml` (`~/.config/tsuzuri/trust.toml` by default). A `.js` module loads on every runtime, and `.ts` where the runtime strips types, as Bun and Node 24 do.

`await Vault.open(root)` loads the listed extensions. `new Vault(root)` loads none of them itself; a host passes extensions it imported in code with `new Vault(root, { extensions: [journal] })`. An extension a vault lists but a `Vault` did not load is reported in `vault.skipped` with the reason, and the CLI prints it on stderr; the vault opens with the rest. A table in `tsuzuri.toml`, such as `[journal]`, is accepted when a loaded extension reads it, and otherwise refused unless an extension was skipped, which may be the one it belongs to.

## the mask

An extension's operations have names and kinds, so a mask names them as it names tsuzuri's: `allow: ["read", "journalAppend"]` or `allow: ["read", "edit"]`. Every call an operation makes through the vault it is given is checked by the same mask: allowing `journalAppend` by name does not allow the `append` it makes, while allowing the `edit` kind allows both.

An `under` rule cannot include an extension operation, by name or kind: `Vault.run` cannot know that operation's paths in advance. Such a rule raises `ConfigError`. Allow the extension operation without a folder and scope its core calls instead, for example `allow: ["journal", { ops: ["get"], under: ["Inbox"] }]`. A vault module loaded with `trust` is executable code; the mask checks its calls through `Vault`, not direct filesystem calls ([ADR 0021](decisions/0021-scope-derived-paths-and-extension-operations.md)).

## writing one

A module the vault holds exports its extension as the default: a plain object, since a vault has no `node_modules` to import tsuzuri from.

```js
export default {
  name: "reading",
  table: "reading", // optional: the tsuzuri.toml table it reads
  settings: (table) => ({ folder: table?.folder ?? "Books" }), // optional: check and parse that table
  operations: [
    {
      name: "unread", // camelCase, unique among every operation
      kind: "read", // read, create, edit, move, or delete
      command: "unread", // the CLI's words; "reading list" makes two
      summary: "Books not yet read, newest first.",
      input: {
        limit: { type: "integer", description: "Most books" },
      },
      run: (vault, input, { settings }) =>
        vault.list({ under: settings.folder, where: { status: "unread" }, sort: "created", desc: true, limit: input.limit }),
      format: (result) => result.map((book) => book.title).join("\n"), // optional: the CLI's text output
    },
  ],
};
```

- **Input:** each input has a JSON Schema `type` (`string`, `integer`, `boolean`, or `array`), a `description`, and optionally an `enum`. Required inputs are the command's arguments, in order, and the last one, when it is free text, takes the remaining words or stdin; the others are `--kebab-case` options. The agent tool takes the same input as a JSON Schema, named `tsuzuri_` and the operation's name in snake_case.
- **`run`** gets the vault, the input, and the extension's parsed settings, and returns what the command prints as JSON with `--json`. It works only through the vault's public methods.
- In code, `defineOperation` and `defineExtension` from `tsuzuri/extension` type-check the same objects, and `formatDate` from the prelude writes a date in the moment-style tokens Obsidian uses.

## the journal

`tsuzuri:journal` finds the day, week, month, quarter, or year note for a date, as Obsidian's Daily Notes and the Periodic Notes plugin name them. Each period it serves has a table with a folder and a moment-style format, which may contain `/`:

```toml
extensions = ["tsuzuri:journal"]

[journal.day]
folder = "Daily"
format = "YYYY-MM-DD"

[journal.week]
folder = "Weekly"
format = "gggg-[W]ww" # locale weeks; GGGG-[W]WW for ISO weeks
```

| Operation | Command | Kind | Does |
| --- | --- | --- | --- |
| `journal` | `journal <period> [--date YYYY-MM-DD]` | read | the note's path, and the note as `get` returns it, or `null` when not written yet |
| `journalAppend` | `journal append <period> <text> [--heading H] [--date] [--dry-run] [--if-hash]` | edit | adds text to the note, as `append` does; the note must exist |

The date is today by default. A period with no table raises `UnsupportedError`. The agent tools are `tsuzuri_journal` and `tsuzuri_journal_append`.
