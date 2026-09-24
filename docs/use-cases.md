# use cases

What people and agents do with neiro, the commands each case walks through, and the tests that hold it in place. A case is **shipped** when every step works today, **partial** when it works with a gap a planned issue closes, and **planned** when it waits on an issue. Update this page with the [roadmap](roadmap.md) when a change ships, and name a covering test for every shipped step. Tests are cited as `file › test name` under `test/`.

## from the terminal

### T1. Find a note I half remember

`search <words>`, then `get <path>`. Shipped.

- `vault.test › ranks a title match first`
- `vault.test › matches Latin words on word boundaries and honours filters`
- `vault.test › matches CJK text as a substring`

### T2. Open a note by its name, title, or alias

`get <ref>`. An ambiguous reference fails and names every candidate instead of picking one. A miss names the closest notes by fuzzy match, even through a typo. Shipped.

- `vault.test › resolves a path, stem, title, or alias`
- `fuzzy.test › suggests the closest notes, even through a typo`
- `vault.test › refuses an ambiguous stem and names the candidates`

### T3. Browse a folder before searching

`nav`, then `nav <folder>`, reading the folder's `index.md` headings. Shipped.

- `vault.test › shows the root folders and notes`
- `vault.test › shows a folder's index note and headings`

### T4. Check the vault's links

`unresolved` for links pointing at nothing or at several notes, `backlinks <note>` before renaming or archiving. `orphans` lists notes nothing links to or embeds. Shipped.

- `vault.test › resolves each wikilink form the way Obsidian does`
- `vault.test › finds backlinks and unresolved links`
- `corpus.test › resolves links consistently`
- `reads.test › counts embeds as links and self-links as nothing, narrowed by the filters`

### T5. Open today's or this week's journal

`journal day|week|month|quarter|year [--date]`, with paths from the vault's own Daily Notes or Periodic Notes settings, or from `neiro.toml`. Shipped.

- `vault.test › reads Obsidian's Daily Notes and Periodic Notes settings`
- `cli.test › prints a journal note for a date`

### T6. Capture a thought, or file a draft

`capture <text>`, `echo … | capture`, or `capture --file draft.md`, with `--dry-run` to look first. The note lands in the vault's capture folder in its house style. Shipped.

- `cli.test › dry-runs a capture from stdin`
- `cli.test › imports a Markdown file, merging --tag`
- `capture.test › write the declared properties in order`
- `capture.test › creates a new file, never overwriting one`

### T7. Recently touched notes, latest in a category

`list --where type=book --sort modified --desc --limit 10`. `--format paths` pipes the result to `xargs` or `fzf`. `--where` takes any frontmatter property, and notes without the sort value come last. Shipped.

- `vault.test › filters by property, tag, and folder`
- `cli.test › --format paths prints one path per line`
- `list.test › give the ten most recently modified books in one call`
- `list.test › matches any frontmatter property as text, and list properties by any item`

## from an agent

An agent reaches neiro in one of two ways: a coding agent shells out to the CLI with `--json`, and a bot imports the SDK in-process. Both see the same operations, and every case below is written for a model that has never seen the vault.

### A1. Orient in an unfamiliar vault

`nav` at the root, then into the folders whose index notes look relevant, before any search. This keeps a model from guessing a layout. Shipped.

- `vault.test › shows a folder's index note and headings`
- `vault.test › skips dot folders and submodule paths`

### A2. Answer a question from the vault, citing notes

`search <question> --limit 5 --json`, then `get <path> --max-chars <n>` on the best hits, answering with their paths. A hit carries the same summary as `list` (type, status, tags, dates), and `--fields` adds any frontmatter key, so the agent can choose between hits without another call. In a long note, `get <path> --lines a:b` reads only the part it needs. Shipped.

- `vault.test › ranks a title match first`
- `vault.test › returns a content hash and marks truncation`
- `vault.test › returns the same summary as list, plus score and snippet`
- `vault.test › selects summary fields and frontmatter keys, null when absent`
- `cli.test › emits JSON with --json`
- `vault.test › counts lines from the top of the file, frontmatter included`

### A3. Locate an exact phrase, then read around it

`grep <pattern>` for `path:line:text`, then `get --around <path:line> --context 10`, which takes a grep or `rg -n` result unchanged. Shipped.

- `grep.test › numbers lines from the top of the file, frontmatter included`
- `grep.test › uses smart case, ignoring escapes`
- `cli.test › takes an rg -n result for --around unchanged`
- `vault.test › reads around a line, clipped at either end of the file`
- `vault.test › refuses a range the note cannot serve, naming its length`

### A4. Resolve a loose reference from a user's message

The user writes "that note about oolong". `get` resolves a path, file name, title, or alias; on a miss, `find` ranks near matches by fuzzy score. Shipped. How Obsidian treats a bare alias link is open in [#24](https://github.com/azusachino/neiro/issues/24).

- `vault.test › resolves a path, stem, title, or alias`
- `fuzzy.test › ranks Latin titles, aliases, and paths`
- `fuzzy.test › ranks CJK titles`
- `fuzzy.test › prints the suggestions from the CLI and exits 1`

### A5. Capture a chat message into the vault

A bot receives a message, previews it with `capture(…, { dryRun: true })`, and on confirmation writes it with `{ push: true, author: "bot <bot@example.com>" }`: one new file, one commit, attributed to the bot, never touching an existing note. Shipped.

- `capture.test › dry run writes nothing`
- `capture.test › commits only the new note, as the given author`
- `capture.test › pulls, commits, and pushes`
- `capture.test › reports a Git failure`

### A6. Tag a capture with the vault's own tags

The agent lists existing tags with their counts and picks from them instead of inventing a near-duplicate. `tags --json` gives each tag with its note count, parents of nested tags included, and capture enforces the vault's required, rejected, and kebab-case rules. Shipped.

- `capture.test › enforce required, kebab-case, and rejected tags`
- `capture.test › keep titles and tags as written, checking Obsidian's tag syntax`
- `tags.test › counts notes per tag, parents of nested tags included, case variants merged`
- `tags.test › prints counts from the CLI, and --tag may repeat`

### A7. Summarize the week, then record the summary

`journal week` to read, then `journal append week <text> --heading <h>` to add to the note. Shipped; which writes an agent may call without a human is decided in [#19](https://github.com/azusachino/neiro/issues/19).

- `vault.test › reads Obsidian's Daily Notes and Periodic Notes settings`
- `sections.test › appends to the journal note for a date, which must exist`

### A8. Edit a note without overwriting the owner's change

`get` returns the note's `hash`; a write passes it back with `--if-hash` and is refused when the file changed in between, with `--dry-run` showing the diff first. `append`, `section put`, and `journal append` take both. Shipped.

- `vault.test › returns a content hash and marks truncation`
- `write.test › refuses a stale hash and accepts the one get returned`
- `sections.test › a dry run returns the diff and writes nothing; a stale hash is refused`

### A9. Stop instead of guessing

When the vault does not say where something lives, neiro raises `UnsupportedError` rather than inventing a path, and the CLI exits 1 for a missing or unsupported request and 2 for bad usage, so an agent can tell its own mistake from the vault's. Shipped.

- `vault.test › raises UnsupportedError for a period no setting covers`
- `cli.test › exits 1 for a missing note and 2 for bad usage`
- `chain.test › names the capability and what each provider needs when none is available`

### A10. Serve a long-running bot from a Git clone

A bot in a container with no GUI keeps one `Vault`, pulls the clone, and calls `vault.reload()` so reads see the new files. It runs on Bun or Node. Partial: `reload()` and Node support ship; a refresh policy is [#20](https://github.com/azusachino/neiro/issues/20), and the container recipe is [#21](https://github.com/azusachino/neiro/issues/21).

- `make node-smoke`, which runs the read commands on Node and requires Bun's output
- `chain.test › parse TOML, for neiro.toml and its title allowlist`

### A11. Hand an agent framework neiro's tools

Import ready-made tool definitions with parameter schemas and read-only or destructive hints, instead of writing wrappers. `agentTools()` returns each tool with its JSON Schema, MCP-style hints, an exposure (`direct` or `confirm`), and a `run` bound to the SDK; the consumer decides whether writes commit and push. Shipped; the default exposure follows the roadmap's proposal, pending the owner's agreement.

- `tools.test › have valid JSON Schemas: closed objects whose required inputs are declared and described`
- `tools.test › writes take the model's guards and the consumer's commit policy`
