import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOLS } from "../src/index.ts";
import { copyVault } from "./git.ts";
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

  test("reports a bad date or a malformed neiro.toml in one line", () => {
    const date = run("journal", "day", "--date", "2026-13-01");
    expect(date.code).toBe(1);
    expect(date.stderr.trim()).toBe('neiro: not a calendar date: "2026-13-01"');
    const root = mkdtempSync(join(tmpdir(), "neiro-badtoml-"));
    writeFileSync(join(root, "neiro.toml"), "capture = [\n");
    const result = Bun.spawnSync(["bun", CLI, "--vault", root, "list"], { stderr: "pipe" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toStartWith("neiro: neiro.toml: ");
    expect(result.stderr.toString().trim().split("\n")).toHaveLength(1);
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

describe("cli get by line", () => {
  test("takes an rg -n result for --around unchanged", () => {
    const hit = "Topics/Cognitive load.md:9:Cognitive load theory explains why working memory limits learning.";
    const { code, stdout } = run("get", "--around", hit, "--context", "0", "--json");
    expect(code).toBe(0);
    const slice = JSON.parse(stdout);
    expect(slice).toMatchObject({ path: "Topics/Cognitive load.md", start: 9, end: 9, total: 27 });
    expect(slice.body).toBe(hit.split(":").slice(2).join(":"));
  });

  test("reads --lines ranges, open-ended or one line", () => {
    expect(run("get", "clt", "--lines", "1:2").stdout).toBe("Topics/Cognitive load.md:1-2 of 27\n\n---\naliases:\n");
    expect(JSON.parse(run("get", "clt", "--lines", "26:", "--json").stdout)).toMatchObject({ start: 26, end: 27 });
    expect(JSON.parse(run("get", "clt", "--lines", "9", "--json").stdout)).toMatchObject({ start: 9, end: 9 });
  });

  test("exits 1 for a range past the note and 2 for malformed options", () => {
    expect(run("get", "clt", "--lines", "99").code).toBe(1);
    expect(run("get", "clt", "--lines", "a:b").code).toBe(2);
    expect(run("get", "clt", "--context", "3").code).toBe(2);
    expect(run("get", "clt", "--around", "Topics/Cognitive load.md:9").code).toBe(2);
    expect(run("get", "--around", "nowhere").code).toBe(2);
  });
});

describe("cli output shapes", () => {
  test("--fields keeps the named fields, in JSON or as tab-separated text", () => {
    const json = run("list", "--type", "person", "--fields", "path,born", "--json");
    expect(JSON.parse(json.stdout)).toEqual([
      { path: "People/Greek/Plato.md", born: null },
      { path: "People/Plato.md", born: -428 },
    ]);
    expect(run("get", "People/Plato.md", "--fields", "title,tags").stdout).toBe('Plato\t["philosophy"]\n');
  });

  test("--format paths prints one path per line", () => {
    expect(run("list", "--type", "person", "--format", "paths").stdout).toBe(
      "People/Greek/Plato.md\nPeople/Plato.md\n",
    );
    expect(run("nav", "Topics", "--format", "paths").stdout).toBe(
      "Topics/index.md\nTopics/Cognitive load.md\nTopics/Working memory.md\n",
    );
  });

  test("refuses a shape a command cannot produce", () => {
    expect(run("unresolved", "--format", "paths").code).toBe(2);
    expect(run("links", "clt", "--fields", "path").code).toBe(2);
    expect(run("list", "--format", "yaml").code).toBe(2);
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

describe("errors under --json", () => {
  const errorOf = (...args: string[]) => {
    const { code, stderr } = run(...args, "--json");
    return { code, error: JSON.parse(stderr.trim()).error };
  };

  test("name the error and carry its own fields, such as the closest notes", () => {
    const { code, error } = errorOf("get", "cognitive laod");
    expect(code).toBe(1);
    expect(error.name).toBe("NotFoundError");
    expect(error.message).toStartWith('no note matches "cognitive laod"');
    expect(error.suggestions[0]).toBe("Topics/Cognitive load.md");
  });

  test("report a usage error, and an option that fails to parse, as UsageError with exit 2", () => {
    expect(errorOf("get", "Home", "--limit", "3")).toMatchObject({ code: 2, error: { name: "UsageError" } });
    const parsed = errorOf("get", "--bogus");
    expect(parsed).toMatchObject({ code: 2, error: { name: "UsageError" } });
    expect(parsed.error.message).toContain("--bogus");
  });
});

describe("tools", () => {
  test("prints the agent tool definitions, the SDK's without run", () => {
    const { code, stdout } = run("tools", "--json");
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual(
      JSON.parse(JSON.stringify(TOOLS.map(({ run: _, ...definition }) => definition))),
    );
    expect(run("tools").stdout).toContain("neiro_capture\tdirect\tadds\t");
  });
});

describe("help", () => {
  interface HelpJson {
    commands: { name: string; options: { name: string }[]; example: string }[];
  }
  const help = (): HelpJson => JSON.parse(run("help", "--json").stdout);

  test("runs every command's example without a usage error", () => {
    const root = copyVault();
    for (const { name, example } of help().commands) {
      const words = [...example.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2] ?? "").slice(1);
      const result = Bun.spawnSync(["bun", CLI, "--vault", root, ...words], { stdout: "pipe", stderr: "pipe" });
      expect(result.exitCode, `${name}: ${result.stderr.toString()}`).not.toBe(2);
    }
  });

  test("gives one command's help for <command> --help and help <command>", () => {
    const direct = run("get", "--help");
    expect(direct.code).toBe(0);
    expect(direct.stdout).toBe(run("help", "get").stdout);
    expect(direct.stdout).toStartWith("usage: neiro get <note>");
    expect(direct.stdout).toContain("--lines <a:b>");
    expect(direct.stdout).not.toContain("--limit");
    expect(run("help", "journal").stdout).toContain("usage: neiro journal append");
  });

  test("lists every command with its options as JSON", () => {
    const commands = help().commands;
    expect(commands.map((command) => command.name)).toContain("section put");
    expect(commands.find((command) => command.name === "grep")?.options.map((option) => option.name)).toContain(
      "--fixed-strings",
    );
  });

  test("docs/cli.md names every command and each of its options, and nothing else", () => {
    const page = readFileSync(join(import.meta.dir, "..", "docs", "cli.md"), "utf8");
    const sections = new Map(
      page
        .split(/^### /m)
        .slice(1)
        .map((section) => [section.slice(0, section.indexOf("\n")), section] as const),
    );
    const commands = help().commands;
    expect([...sections.keys()].sort()).toEqual(commands.map((command) => command.name).sort());
    for (const { name, options } of commands) {
      for (const option of options) expect(sections.get(name), `${name} ${option.name}`).toContain(`${option.name}`);
    }
  });

  test("refuses an option the command does not take", () => {
    const { code, stderr } = run("get", "Home", "--limit", "3");
    expect(code).toBe(2);
    expect(stderr).toStartWith("neiro: get does not take --limit; run neiro help get");
  });
});
