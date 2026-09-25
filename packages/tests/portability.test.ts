import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "neiro";

describe("portability", () => {
  test("reads frontmatter after a byte order mark", async () => {
    const root = mkdtempSync(join(tmpdir(), "neiro-bom-"));
    writeFileSync(join(root, "note.md"), "\uFEFF---\ntitle: Marked\n---\n\nBody\n");
    expect((await new Vault(root).find("note")).title).toBe("Marked");
  });
});
