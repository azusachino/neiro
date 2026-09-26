# 0005 capture creates; edits target one part, guarded

Status: accepted, 2026-09-24 (0.1.0 capture, 0.3.0 edits); recorded 2026-09-25. Its commit steps are superseded by [ADR 0008](0008-files-only-no-git-no-server.md), and the rest, except its guards, by [ADR 0016](0016-the-sdk-reads-and-writes-the-whole-vault.md).

## context

The owner edits the vault by hand, and agents write into it too. A write that rewrites a whole note can destroy an edit the owner made a moment earlier, and a model that misreads a request can do more damage the more a write can touch. At 0.1.0 neiro's only write was `capture`; 0.3.0 added edits, which needed rules that keep them from clobbering the owner.

## decision

- **Capture creates, never edits.** `capture` and `new` write one new file in the capture folder, never overwriting one, so they cannot conflict with a note being edited.
- **An edit targets one part of a note**: a section by heading (`append`, `section put`, `journal append`) or one frontmatter key (`prop set`). It changes only that range and leaves every other byte unchanged. Replacing a whole note (`put`) is refused without a matching hash.
- **Every edit is guarded.** `--dry-run` returns a unified diff and writes nothing. `--if-hash` refuses a note whose content hash changed since `get` returned it, like HTTP's `If-Match`. A write replaces the file whole through a rename, so no reader sees half a note (0.5.0).
- **Nothing deletes.** Archiving waits for a rename that rewrites links.
- **A new write verb needs the owner's agreement**, and must target a heading or a key rather than rewrite a note.

## alternatives considered

- **Whole-note writes as the normal edit**: rejected as the easiest way to overwrite the owner's change.
- **Locking the note** instead of a hash check: not recorded as considered; a lock needs every editor, Obsidian included, to honour it, while a hash check needs only the writer.
- **A delete verb**: not planned.

## consequences

Writes are small, reviewable, and refuse rather than overwrite. A caller that wants to change a note must read it first and pass the hash back, which costs a read per write. Structural changes, such as moving a section or renaming a note, have no verb.
