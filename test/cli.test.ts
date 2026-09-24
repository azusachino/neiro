import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE } from "./vault.test.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

function run(...args: string[]): { code: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["bun", CLI, "--vault", FIXTURE, ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

describe("cli", () => {
  test("emits JSON with --json", () => {
    const { code, stdout } = run("list", "--type", "person", "--json");
    expect(code).toBe(0);
    expect(JSON.parse(stdout).map((note: { path: string }) => note.path)).toEqual([
      "People/Greek/Plato.md",
      "People/Plato.md",
    ]);
  });

  test("prints a journal note for a date", () => {
    const { code, stdout } = run("journal", "day", "--date", "2026-09-16");
    expect(code).toBe(0);
    expect(stdout).toStartWith("Daily/2026-09-16.md");
  });

  test("dry-runs a capture from stdin", () => {
    const result = Bun.spawnSync(["bun", CLI, "--vault", FIXTURE, "capture", "--dry-run", "--json"], {
      stdin: new TextEncoder().encode("- from stdin\n"),
      stdout: "pipe",
    });
    expect(JSON.parse(result.stdout.toString())).toMatchObject({ path: "Inbox/from stdin.md", written: false });
  });

  test("exits 1 for a missing note and 2 for bad usage", () => {
    expect(run("get", "nothing-here").code).toBe(1);
    expect(run("journal", "month").code).toBe(1);
    expect(run("journal", "fortnight").code).toBe(2);
    expect(run("nope").code).toBe(2);
    expect(run("list", "--bogus").code).toBe(2);
    expect(run("search").code).toBe(2);
    expect(run("search", "x", "--limit", "0").code).toBe(2);
  });
});

describe("cli capture --file", () => {
  const draft = join(mkdtempSync(join(tmpdir(), "neiro-draft-")), "Weekend plan.md");
  writeFileSync(draft, "---\ntags:\n  - planning\n---\n\n- buy tea\n- read a book\n");

  test("imports a Markdown file, merging --tag", () => {
    const { code, stdout } = run("capture", "--file", draft, "--tag", "home", "--dry-run", "--json");
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.path).toBe("Inbox/Weekend plan.md");
    expect(result.content).toBe("---\ntags:\n  - planning\n  - home\n---\n\n- buy tea\n- read a book\n");
  });

  test("refuses text and --file together", () => {
    expect(run("capture", "--file", draft, "extra text").code).toBe(2);
  });
});
