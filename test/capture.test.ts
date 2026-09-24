import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CaptureError,
  captureInputFromMarkdown,
  type NeiroConfig,
  renderCapture,
  resolveSettings,
  splitFrontmatter,
  Vault,
} from "../src/index.ts";
import { FIXTURE } from "./vault.test.ts";

const NOW = new Date(2026, 8, 24, 19, 5);

/** A vault that declares a strict house style, the way a vault's own neiro.toml would. */
const STRICT: NeiroConfig = {
  capture: {
    folder: "queue",
    filename: "slug",
    properties: ["title", "created", "modified", "kind", "tags", "source"],
    values: { kind: "capture" },
    title_style: "lowercase",
    tag_style: "kebab",
    require_tags: true,
    reject_tags: ["todo"],
  },
};

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

describe("default capture settings", () => {
  const defaults = resolveSettings(FIXTURE).capture;

  test("follow Obsidian: new-note folder from app.json, title as file name, only tags", () => {
    expect(defaults).toMatchObject({ folder: "Inbox", filename: "title", properties: ["tags", "source"] });
    const { content } = renderCapture({ text: "Body line", title: "A Title", tags: ["learning"], now: NOW }, defaults);
    expect(content).toBe("---\ntags:\n  - learning\n---\n\nBody line\n");
  });

  test("write no frontmatter when there is nothing to record", () => {
    expect(renderCapture({ text: "Just text", now: NOW }, defaults).content).toBe("Just text\n");
  });

  test("keep titles and tags as written, checking Obsidian's tag syntax", () => {
    const { title, content } = renderCapture(
      { text: "Using the API", tags: ["#Area/Sub_topic", "2026-plans"] },
      defaults,
    );
    expect(title).toBe("Using the API");
    expect(content).toContain("tags:\n  - Area/Sub_topic\n  - 2026-plans\n");
    expect(() => renderCapture({ text: "x", tags: ["two words"] }, defaults)).toThrow("not a valid tag");
    expect(() => renderCapture({ text: "x", tags: ["2026"] }, defaults)).toThrow("not a valid tag");
  });

  test("fall back to the vault root without Obsidian settings", () => {
    expect(resolveSettings(join(FIXTURE, "People")).capture.folder).toBe("");
  });
});

describe("configured capture settings", () => {
  const strict = resolveSettings(FIXTURE, STRICT).capture;

  test("write the declared properties in order", () => {
    const { content } = renderCapture({ text: "Body", title: "An Idea", tags: ["Agent_Harness"], now: NOW }, strict);
    expect(content).toBe(
      [
        "---",
        "title: an idea",
        "created: 2026-09-24",
        "modified: 2026-09-24",
        "kind: capture",
        "tags:",
        "  - agent-harness",
        "---",
        "",
        "Body",
        "",
      ].join("\n"),
    );
  });

  test("write created and modified in the configured timestamp format", () => {
    const timed = resolveSettings(FIXTURE, {
      capture: { ...STRICT.capture, timestamp_format: "YYYY-MM-DD HH:mm" },
    }).capture;
    const { content } = renderCapture({ text: "Body", title: "An Idea", tags: ["x"], now: NOW }, timed);
    expect(content).toContain("created: 2026-09-24 19:05\nmodified: 2026-09-24 19:05\n");
  });

  test("quote values YAML would misread, and they round-trip", () => {
    const { content } = renderCapture(
      { text: "x", title: "read: this", tags: ["x"], source: "a #b", now: NOW },
      strict,
    );
    expect(content).toContain('title: "read: this"');
    expect(splitFrontmatter(content).data).toMatchObject({ title: "read: this", source: "a #b" });
  });

  test("take the title from the first line, without Markdown syntax", () => {
    expect(renderCapture({ text: "\n## Some Heading\nmore", tags: ["x"] }, strict).title).toBe("some heading");
    expect(renderCapture({ text: "- a list item", tags: ["x"] }, strict).title).toBe("a list item");
    expect(renderCapture({ text: "x".repeat(100), tags: ["x"] }, strict).title).toHaveLength(81);
  });

  test("lowercase titles except allowlisted words, and space CJK", () => {
    const allow = { ...strict, titleAllow: ["API", "iPhone"] };
    expect(renderCapture({ text: "Using the API on iPhone", tags: ["x"] }, allow).title).toBe(
      "using the API on iPhone",
    );
    expect(renderCapture({ text: "Two APIs", tags: ["x"] }, allow).title).toBe("two APIs");
    expect(renderCapture({ text: "学习Kafka原理", tags: ["x"] }, allow).title).toBe("学习 kafka 原理");
  });

  test("enforce required, kebab-case, and rejected tags", () => {
    expect(
      renderCapture({ text: "x", tags: [" Agent_Harness ", "agent-harness", "分布式"] }, strict).content,
    ).toContain("tags:\n  - agent-harness\n  - 分布式\n");
    expect(() => renderCapture({ text: "x", tags: [] }, strict)).toThrow("requires at least one tag");
    expect(() => renderCapture({ text: "x", tags: ["todo"] }, strict)).toThrow('does not allow the tag "todo"');
    expect(() => renderCapture({ text: "x", tags: ["c++"] }, strict)).toThrow("not a valid tag");
    expect(() => renderCapture({ text: "  ", tags: ["x"] }, strict)).toThrow(CaptureError);
  });

  test("read the title allowlist named in neiro.toml", async () => {
    const root = copyVault();
    writeFileSync(join(root, "casing.toml"), '[allow]\nwords = ["OpenAI"]\n');
    writeFileSync(join(root, "neiro.toml"), '[capture]\ntitle_style = "lowercase"\ntitle_allowlist = "casing.toml"\n');
    const result = await new Vault(root).capture({ text: "Trying OpenAI Tools" }, { dryRun: true });
    expect(result.path).toBe("Inbox/trying OpenAI tools.md");
  });
});

describe("capture", () => {
  test("dry run writes nothing", async () => {
    const root = copyVault();
    const result = await new Vault(root).capture({ text: "An idea", now: NOW }, { dryRun: true });
    expect(result).toMatchObject({ path: "Inbox/An idea.md", written: false, committed: false, pushed: false });
    expect(existsSync(join(root, result.path))).toBe(false);
  });

  test("creates a new file, never overwriting one", async () => {
    const root = copyVault();
    const vault = new Vault(root);
    const first = await vault.capture({ text: "Existing idea", now: NOW });
    const slugged = await new Vault(root, { config: STRICT }).capture({ text: "Existing idea", tags: ["x"], now: NOW });
    const again = await new Vault(root, { config: STRICT }).capture({ text: "Existing idea", tags: ["x"], now: NOW });
    expect([first.path, slugged.path, again.path]).toEqual([
      "Inbox/Existing idea 2.md",
      "queue/existing-idea.md",
      "queue/existing-idea-2.md",
    ]);
    expect(readFileSync(join(root, "Inbox/Existing idea.md"), "utf8")).toContain("Captured earlier.");
  });

  test("makes file names safe, falling back to a timestamp", async () => {
    const vault = new Vault(copyVault());
    expect((await vault.capture({ text: 'What is "a/b"? [draft]', now: NOW }, { dryRun: true })).path).toBe(
      "Inbox/What is a b draft.md",
    );
    expect((await vault.capture({ text: "乌龙茶笔记", now: NOW }, { dryRun: true })).path).toBe("Inbox/乌龙茶笔记.md");
    const strict = new Vault(copyVault(), { config: STRICT });
    expect((await strict.capture({ text: "乌龙茶", tags: ["tea"], now: NOW }, { dryRun: true })).path).toBe(
      "queue/capture-20260924-1905.md",
    );
  });

  test("commits only the new note, as the given author", async () => {
    const { root } = gitVault();
    writeFileSync(join(root, "Notes/乌龙茶.md"), "an unrelated owner edit\n");
    const result = await new Vault(root).capture(
      { text: "Committed idea", now: NOW },
      { commit: true, author: "bot <bot@example.com>" },
    );
    expect(result).toMatchObject({ written: true, committed: true, pushed: false });
    expect(git(root, "log", "-1", "--format=%an|%s")).toBe("bot|chore: capture Inbox/Committed idea.md");
    expect(git(root, "show", "--name-only", "--format=", "HEAD")).toBe("Inbox/Committed idea.md");
    expect(git(root, "status", "--short")).toContain("Notes/");
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

    await new Vault(root).capture({ text: "Pushed idea", now: NOW }, { push: true });
    expect(git(remote, "log", "-2", "--format=%s", "main").split("\n")).toEqual([
      "chore: capture Inbox/Pushed idea.md",
      "elsewhere",
    ]);
  });

  test("reports a Git failure", async () => {
    const root = copyVault();
    expect(new Vault(root).capture({ text: "No repo" }, { commit: true })).rejects.toThrow("git add failed");
    expect(readdirSync(join(root, "Inbox"))).toContain("No repo.md");
  });
});

describe("captureInputFromMarkdown", () => {
  const draft = [
    "---",
    "title: A drafted idea",
    "tags:",
    "  - learning",
    "source: https://example.com/post",
    "author: Someone",
    "kind: draft",
    "rating: 4",
    "---",
    "",
    "# A heading that is not the title",
    "",
    "Body text.",
    "",
  ].join("\n");

  test("takes title, tags, and source from the file's properties and keeps the body", () => {
    const input = captureInputFromMarkdown(draft, "tmp/draft.md");
    expect(input).toMatchObject({
      title: "A drafted idea",
      tags: ["learning"],
      source: "https://example.com/post",
      properties: { author: "Someone", kind: "draft", rating: 4 },
    });
    expect(input.text).toBe("\n# A heading that is not the title\n\nBody text.\n");
  });

  test("falls back to the first heading, then the file name", () => {
    expect(captureInputFromMarkdown("## First heading ##\n\ntext\n", "x.md").title).toBe("First heading");
    expect(captureInputFromMarkdown("plain text\n", "tmp/My draft.md").title).toBe("My draft");
    expect(captureInputFromMarkdown("plain text\n").title).toBeUndefined();
  });

  test("keeps the file's other properties after the declared ones, never duplicating a declared key", () => {
    const strict = resolveSettings(FIXTURE, STRICT).capture;
    const { content } = renderCapture({ ...captureInputFromMarkdown(draft, "draft.md"), now: NOW }, strict);
    const { data } = splitFrontmatter(content);
    expect(data).toMatchObject({ title: "a drafted idea", kind: "capture", author: "Someone", rating: 4 });
    expect(content.match(/^kind:/gm)).toHaveLength(1);
    expect(content.indexOf("author:")).toBeGreaterThan(content.indexOf("source:"));
  });
});
