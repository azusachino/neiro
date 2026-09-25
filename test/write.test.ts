import { describe, expect, test } from "bun:test";
import { chmodSync, lstatSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  contentHash,
  GitHistory,
  splice,
  UnsupportedError,
  Vault,
  WriteConflictError,
  writeNote,
} from "../src/index.ts";
import { copyVault, git, gitVault } from "./git.ts";

const NOTE = "Topics/Cognitive load.md";
const noHistory = () => {
  throw new UnsupportedError("no history in this test");
};

describe("splice", () => {
  test("changes only the target range", () => {
    expect(splice("abcdef", 2, 4, "XY")).toBe("abXYef");
    expect(splice("abc", 3, 3, "!")).toBe("abc!");
    expect(() => splice("abc", 2, 1, "")).toThrow(RangeError);
  });
});

describe("writeNote", () => {
  test("leaves every byte outside the target unchanged", async () => {
    const root = copyVault();
    const before = readFileSync(join(root, NOTE));
    const target = "working memory limits learning";
    const result = await writeNote(
      root,
      NOTE,
      (text = "") => splice(text, text.indexOf(target), text.indexOf(target) + target.length, "limits learning"),
      "edit",
      {},
      noHistory,
    );
    const after = readFileSync(join(root, NOTE));
    const start = before.indexOf(target);
    expect(result).toMatchObject({ written: true, created: false, committed: false });
    expect(after.subarray(0, start)).toEqual(before.subarray(0, start));
    expect(after.subarray(start + "limits learning".length)).toEqual(before.subarray(start + target.length));
  });

  test("refuses a stale hash and accepts the one get returned", async () => {
    const root = copyVault();
    const vault = new Vault(root);
    const { hash } = await vault.get(NOTE);
    expect(contentHash(readFileSync(join(root, NOTE), "utf8"))).toBe(hash);
    const edit = (text = "") => `${text}one more line\n`;
    expect((await writeNote(root, NOTE, edit, "edit", { ifHash: hash }, noHistory)).written).toBe(true);
    await expect(writeNote(root, NOTE, edit, "edit", { ifHash: hash }, noHistory)).rejects.toThrow(WriteConflictError);
    await expect(writeNote(root, "Nowhere.md", edit, "edit", { ifHash: hash }, noHistory)).rejects.toThrow(
      "does not exist",
    );
  });

  test("returns a unified diff and writes nothing on a dry run", async () => {
    const root = copyVault();
    const before = readFileSync(join(root, NOTE), "utf8");
    const result = await writeNote(root, NOTE, (text = "") => `${text}appended\n`, "edit", { dryRun: true }, noHistory);
    expect(result.written).toBe(false);
    expect(result.diff).toContain(`--- a/${NOTE}`);
    expect(result.diff).toContain("+appended");
    expect(readFileSync(join(root, NOTE), "utf8")).toBe(before);
  });

  test("keeps a byte order mark, and creates a missing note", async () => {
    const root = copyVault();
    writeFileSync(join(root, "Marked.md"), "\uFEFFfirst\n");
    await writeNote(root, "Marked.md", (text = "") => `${text}second\n`, "edit", {}, noHistory);
    expect(readFileSync(join(root, "Marked.md"))[0]).toBe(0xef);
    expect(readFileSync(join(root, "Marked.md"), "utf8")).toBe("\uFEFFfirst\nsecond\n");
    const created = await writeNote(root, "New/Fresh.md", () => "fresh\n", "create", {}, noHistory);
    expect(created).toMatchObject({ created: true, written: true });
  });

  test("replaces a note whole, keeping its mode and any symbolic link, with no temporary file left", async () => {
    const root = copyVault();
    chmodSync(join(root, NOTE), 0o640);
    await writeNote(root, NOTE, (text = "") => `${text}more\n`, "edit", {}, noHistory);
    expect(statSync(join(root, NOTE)).mode & 0o777).toBe(0o640);
    writeFileSync(join(root, "Real.md"), "real\n");
    symlinkSync("Real.md", join(root, "Link.md"));
    await writeNote(root, "Link.md", () => "through the link\n", "edit", {}, noHistory);
    expect(lstatSync(join(root, "Link.md")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(root, "Real.md"), "utf8")).toBe("through the link\n");
    const leftovers = [root, join(root, "Topics")].flatMap((dir) =>
      readdirSync(dir).filter((name) => name.endsWith(".tmp")),
    );
    expect(leftovers).toEqual([]);
  });

  test("commits one revision of the note alone, and asks for history before writing", async () => {
    const { root } = gitVault();
    writeFileSync(join(root, "Home.md"), "an unrelated edit\n");
    const history = new GitHistory(root);
    const result = await writeNote(
      root,
      NOTE,
      (text = "") => `${text}x\n`,
      "docs: edit",
      { commit: true },
      () => history,
    );
    expect(result.committed).toBe(true);
    expect(git(root, "show", "--name-only", "--format=%s", "HEAD").split("\n")).toEqual(["docs: edit", "", NOTE]);

    const plain = copyVault();
    const before = readFileSync(join(plain, NOTE), "utf8");
    await expect(writeNote(plain, NOTE, () => "changed", "edit", { commit: true }, noHistory)).rejects.toThrow(
      UnsupportedError,
    );
    expect(readFileSync(join(plain, NOTE), "utf8")).toBe(before);
  });
});
