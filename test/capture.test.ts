import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CaptureError, renderCapture, splitFrontmatter, Vault } from "../src/index.ts";
import { FIXTURE } from "./vault.test.ts";

const NOW = new Date(2026, 8, 24, 19, 5);

function copyVault(): string {
  const root = mkdtempSync(join(tmpdir(), "neiro-vault-"));
  cpSync(FIXTURE, root, { recursive: true });
  return root;
}

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

function gitVault(): { root: string; remote: string } {
  const remote = mkdtempSync(join(tmpdir(), "neiro-remote-"));
  git(remote, "init", "--quiet", "--bare", "--initial-branch=main");
  const root = copyVault();
  git(root, "init", "--quiet", "--initial-branch=main");
  git(root, "config", "user.name", "owner");
  git(root, "config", "user.email", "owner@example.com");
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "init");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "--quiet", "-u", "origin", "main");
  return { root, remote };
}

describe("renderCapture", () => {
  test("writes frontmatter in the vault's canonical order", () => {
    const { content } = renderCapture({ text: "Body line", title: "a title", tags: ["learning"], now: NOW });
    expect(content).toBe(
      [
        "---",
        "title: a title",
        "created: 2026-09-24 19:05",
        "modified: 2026-09-24 19:05",
        "type: inbox",
        "status: inbox",
        "maturity: seed",
        "tags:",
        "  - learning",
        "---",
        "",
        "Body line",
        "",
      ].join("\n"),
    );
  });

  test("quotes values YAML would misread, and they round-trip", () => {
    const { content } = renderCapture({ text: "x", title: "read: this", tags: ["2026"], source: "a #b", now: NOW });
    expect(content).toContain('title: "read: this"');
    expect(content).toContain('  - "2026"');
    const { data } = splitFrontmatter(content);
    expect(data).toMatchObject({ title: "read: this", tags: ["2026"], source: "a #b" });
  });

  test("takes the title from the first line, without Markdown syntax", () => {
    expect(renderCapture({ text: "\n## Some Heading\nmore", tags: ["x"], now: NOW }).title).toBe("some heading");
    expect(renderCapture({ text: "- a list item", tags: ["x"], now: NOW }).title).toBe("a list item");
    expect(renderCapture({ text: "x".repeat(100), tags: ["x"], now: NOW }).title).toHaveLength(81);
  });

  test("lowercases title words outside the allowlist and spaces CJK", () => {
    const allow = new Set(["API", "iPhone"]);
    expect(renderCapture({ text: "Using the API on iPhone", tags: ["x"] }, { titleAllow: allow }).title).toBe(
      "using the API on iPhone",
    );
    expect(renderCapture({ text: "Two APIs", tags: ["x"] }, { titleAllow: allow }).title).toBe("two APIs");
    expect(renderCapture({ text: "Using the LLM API", tags: ["x"] }).title).toBe("using the LLM API");
    expect(renderCapture({ text: "学习Kafka原理", tags: ["x"] }).title).toBe("学习 kafka 原理");
  });

  test("canonicalizes tags and rejects bad ones", () => {
    expect(renderCapture({ text: "x", tags: [" Agent_Harness ", "agent-harness", "分布式"] }).content).toContain(
      "tags:\n  - agent-harness\n  - 分布式\n",
    );
    expect(() => renderCapture({ text: "x", tags: [] })).toThrow(CaptureError);
    expect(() => renderCapture({ text: "x", tags: ["inbox"] })).toThrow("workflow state");
    expect(() => renderCapture({ text: "x", tags: ["c++"] })).toThrow("punctuation");
    expect(() => renderCapture({ text: "  ", tags: ["x"] })).toThrow("needs text or a title");
  });
});

describe("capture", () => {
  test("dry run writes nothing", async () => {
    const root = copyVault();
    const result = await new Vault(root).capture({ text: "An idea", tags: ["learning"], now: NOW }, { dryRun: true });
    expect(result).toMatchObject({ path: "inbox/an-idea.md", written: false, committed: false, pushed: false });
    expect(existsSync(join(root, result.path))).toBe(false);
  });

  test("creates a new file, never overwriting one", async () => {
    const root = copyVault();
    const vault = new Vault(root);
    const first = await vault.capture({ text: "An existing idea", tags: ["learning"], now: NOW });
    const second = await vault.capture({ text: "An existing idea", tags: ["learning"], now: NOW });
    expect([first.path, second.path]).toEqual(["inbox/an-existing-idea.md", "inbox/an-existing-idea-2.md"]);
    expect(readFileSync(join(root, "inbox/existing-idea.md"), "utf8")).toContain("Captured earlier.");
    expect((await vault.list({ status: "inbox" })).length).toBe(3);
  });

  test("falls back to a timestamp filename for a title without ASCII", async () => {
    const result = await new Vault(copyVault()).capture({ text: "乌龙茶", tags: ["tea"], now: NOW }, { dryRun: true });
    expect(result.path).toBe("inbox/capture-20260924-1905.md");
  });

  test("applies the vault's title allowlist from neiro.toml", async () => {
    const root = copyVault();
    writeFileSync(join(root, "casing.toml"), '[allow]\nwords = ["OpenAI"]\n');
    writeFileSync(join(root, "neiro.toml"), '[capture]\ntitle_allowlist = "casing.toml"\n');
    const result = await new Vault(root).capture({ text: "Trying OpenAI Tools", tags: ["x"] }, { dryRun: true });
    expect(splitFrontmatter(result.content).data.title).toBe("trying OpenAI tools");
  });

  test("commits only the new note, as the given author", async () => {
    const { root } = gitVault();
    writeFileSync(join(root, "note/life/tea.md"), "an unrelated owner edit\n");
    const result = await new Vault(root).capture(
      { text: "Committed idea", tags: ["learning"], now: NOW },
      { commit: true, author: "bot <bot@example.com>" },
    );
    expect(result).toMatchObject({ written: true, committed: true, pushed: false });
    expect(git(root, "log", "-1", "--format=%an|%s")).toBe("bot|chore: capture inbox/committed-idea.md");
    expect(git(root, "show", "--name-only", "--format=", "HEAD")).toBe("inbox/committed-idea.md");
    expect(git(root, "status", "--short")).toBe("M note/life/tea.md");
  });

  test("pulls, commits, and pushes", async () => {
    const { root, remote } = gitVault();
    const other = mkdtempSync(join(tmpdir(), "neiro-other-"));
    git(other, "clone", "--quiet", remote, ".");
    git(
      other,
      "-c",
      "user.name=owner",
      "-c",
      "user.email=owner@example.com",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "elsewhere",
    );
    git(other, "push", "--quiet");

    await new Vault(root).capture({ text: "Pushed idea", tags: ["learning"], now: NOW }, { push: true });
    expect(git(remote, "log", "-2", "--format=%s", "main").split("\n")).toEqual([
      "chore: capture inbox/pushed-idea.md",
      "elsewhere",
    ]);
  });

  test("reports a Git failure", async () => {
    const root = copyVault();
    expect(new Vault(root).capture({ text: "No repo", tags: ["x"] }, { commit: true })).rejects.toThrow(
      "git add failed",
    );
    expect(readdirSync(join(root, "inbox"))).toContain("no-repo.md");
  });
});
