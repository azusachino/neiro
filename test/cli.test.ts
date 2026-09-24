import { describe, expect, test } from "bun:test";
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
      "note/people/greek/plato.md",
      "note/people/plato.md",
    ]);
  });

  test("prints a journal note for a date", () => {
    const { code, stdout } = run("journal", "week", "--date", "2026-09-16");
    expect(code).toBe(0);
    expect(stdout).toStartWith("journal/2026/weekly/2026-w38.md");
  });

  test("dry-runs a capture from stdin", () => {
    const result = Bun.spawnSync(["bun", CLI, "--vault", FIXTURE, "capture", "--dry-run", "--tag", "x", "--json"], {
      stdin: new TextEncoder().encode("- from stdin\n"),
      stdout: "pipe",
    });
    expect(JSON.parse(result.stdout.toString())).toMatchObject({ path: "inbox/from-stdin.md", written: false });
  });

  test("exits 1 for a missing note and 2 for bad usage", () => {
    expect(run("get", "nothing-here").code).toBe(1);
    expect(run("nope").code).toBe(2);
    expect(run("list", "--bogus").code).toBe(2);
    expect(run("search").code).toBe(2);
    expect(run("search", "x", "--limit", "0").code).toBe(2);
  });
});
