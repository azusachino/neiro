# Security

tsuzuri reads a Markdown vault from disk and can write new notes into it, commit them, and push them with Git. It often runs inside an agent, which may pass it text from untrusted sources, so the write path and file-system boundary are where security matters.

## Reporting a vulnerability

Please **do not open a public issue**. Use [GitHub's private vulnerability reporting](https://github.com/azusachino/tsuzuri/security/advisories/new), or the contact on the maintainer's GitHub profile. Include what the issue allows and a concrete reproduction.

## In scope

- Any way to make tsuzuri read or write outside the vault root, for example through a crafted note reference, link, title, or `tsuzuri.toml` path.
- Any way for `capture` to overwrite or modify an existing file, or to commit a file other than the note it created.
- Any way for note content or a title to inject arguments into a Git command.

## Known, accepted tradeoffs

- **Reads return note content verbatim.** An agent that reads a note sees whatever the note contains, including instructions planted in it. Filtering that is the consuming agent's job.
- **Git runs with the caller's credentials.** `--commit` and `--push` use whatever Git identity and remote access the process already has.
