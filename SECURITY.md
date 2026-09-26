# Security

tsuzuri reads a Markdown vault from disk and can write new notes into it and edit existing ones. It often runs inside an agent, which may pass it text from untrusted sources, so the write path and the file-system boundary are where security matters.

## Reporting a vulnerability

Please **do not open a public issue**. Use [GitHub's private vulnerability reporting](https://github.com/azusachino/tsuzuri/security/advisories/new), or the contact on the maintainer's GitHub profile. Include what the issue allows and a concrete reproduction.

## In scope

- Any way to make tsuzuri read or write outside the vault root, for example through a crafted note reference, link, title, or `tsuzuri.toml` path.
- Any way for `capture` or `new` to overwrite or modify an existing file.
- Any way for an edit to change more than the heading or property it targets, or to write despite a stale `--if-hash`.
- Any way for input to an agent tool to do more than its definition and exposure allow, including a `tsuzuri_grep` pattern that stalls the host despite the length cap.

## Known, accepted tradeoffs

- **Reads return note content verbatim.** An agent that reads a note sees whatever the note contains, including instructions planted in it. Filtering that is the consuming agent's job.
- **tsuzuri does not run Git or any other program.** Committing and pushing the vault is the owner's, with the owner's own credentials ([ADR 0008](docs/decisions/0008-files-only-no-git-no-server.md)).
