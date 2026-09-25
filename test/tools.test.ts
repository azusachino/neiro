import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentTools, DEFAULT_EXPOSURE, TOOLS, ToolInputError, Vault, validateInput } from "../src/index.ts";
import { copyVault, git, gitVault } from "./git.ts";

const tool = (name: string) => {
  const found = TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};
const call = (vault: Vault, name: string, input: Record<string, unknown>, context = {}) =>
  tool(name).run(vault, validateInput(tool(name), input), context);

describe("tool definitions", () => {
  test("have unique names every tool-calling API accepts, and descriptions", () => {
    const names = TOOLS.map((definition) => definition.name);
    expect(new Set(names).size).toBe(names.length);
    for (const definition of TOOLS) {
      expect(definition.name).toMatch(/^neiro_[a-z_]{1,58}$/);
      expect(definition.description.length).toBeGreaterThan(20);
    }
  });

  test("have valid JSON Schemas: closed objects whose required inputs are declared and described", () => {
    const types = new Set(["string", "integer", "boolean", "array", "object"]);
    for (const { name, inputSchema } of TOOLS) {
      expect(inputSchema.type).toBe("object");
      expect(inputSchema.additionalProperties).toBe(false);
      for (const key of inputSchema.required) expect(Object.keys(inputSchema.properties)).toContain(key);
      for (const [key, property] of Object.entries(inputSchema.properties)) {
        expect(types.has(property.type), `${name}.${key}`).toBe(true);
        expect(property.description.length, `${name}.${key}`).toBeGreaterThan(3);
        if (property.type === "array") expect(property.items).toEqual({ type: "string" });
        if (property.enum) expect(property.enum.length).toBeGreaterThan(0);
      }
      // Round-trips as JSON, as it must to reach any model API.
      expect(JSON.parse(JSON.stringify(inputSchema))).toEqual(inputSchema);
    }
  });

  test("hint consistently: reads are read-only, and only non-destructive tools are exposed directly", () => {
    for (const { name, annotations, exposure } of TOOLS) {
      if (annotations.readOnlyHint) expect(annotations.destructiveHint, name).toBe(false);
      if (annotations.destructiveHint) expect(exposure, name).not.toBe("direct");
    }
  });

  test("default to the roadmap's exposure, and agentTools never offers cli-only tools", () => {
    expect(DEFAULT_EXPOSURE).toMatchObject({
      neiro_capture: "direct",
      neiro_journal_append: "direct",
      neiro_append: "confirm",
      neiro_section_put: "confirm",
      neiro_prop_set: "confirm",
      neiro_put: "cli-only",
    });
    const offered = agentTools().map((definition) => definition.name);
    expect(offered).not.toContain("neiro_put");
    expect(offered).toContain("neiro_get");
    const locked = agentTools({ ...DEFAULT_EXPOSURE, neiro_capture: "cli-only" }).map((definition) => definition.name);
    expect(locked).not.toContain("neiro_capture");
  });
});

describe("validateInput", () => {
  test("rejects missing, unknown, and mistyped inputs with clear messages", () => {
    expect(() => validateInput(tool("neiro_get"), {})).toThrow("neiro_get needs note");
    expect(() => validateInput(tool("neiro_get"), { note: "x", bogus: 1 })).toThrow("has no input bogus");
    expect(() => validateInput(tool("neiro_search"), { query: "x", limit: 0 })).toThrow(ToolInputError);
    expect(() => validateInput(tool("neiro_list"), { sort: "size" })).toThrow("must be one of");
    expect(() => validateInput(tool("neiro_capture"), { text: "x", tags: ["a", 2] })).toThrow("must be array");
    expect(() => validateInput(tool("neiro_get"), "note")).toThrow("takes an object");
  });
});

describe("running tools", () => {
  test("reads go through the SDK", async () => {
    const vault = new Vault(copyVault());
    expect(await call(vault, "neiro_get", { note: "clt", lines: "1:2" })).toMatchObject({ start: 1, end: 2 });
    expect(((await call(vault, "neiro_find", { query: "wm" })) as { path: string }[])[0]?.path).toBe(
      "Topics/Working memory.md",
    );
    expect(await call(vault, "neiro_list", { where: { born: "-428" } })).toMatchObject([{ path: "People/Plato.md" }]);
    expect(await call(vault, "neiro_prop_get", { note: "People/Plato.md", key: "born" })).toBe(-428);
  });

  test("grep reads a model's pattern as literal text unless regex is set, and caps its length", async () => {
    const vault = new Vault(copyVault());
    const literal = (await call(vault, "neiro_grep", { pattern: "load." })) as unknown[];
    const regex = (await call(vault, "neiro_grep", { pattern: "load.", regex: true })) as unknown[];
    expect(regex.length).toBeGreaterThan(literal.length);
    await expect(call(vault, "neiro_grep", { pattern: "x".repeat(201) })).rejects.toThrow(ToolInputError);
    await expect(call(vault, "neiro_grep", { pattern: "(", regex: true })).rejects.toThrow(ToolInputError);
  });

  test("writes take the model's guards and the consumer's commit policy", async () => {
    const { root, remote } = gitVault();
    const vault = new Vault(root);
    const preview = (await call(vault, "neiro_append", { note: "Home", text: "- x", dryRun: true })) as {
      diff: string;
    };
    expect(preview.diff).toContain("+- x");
    await call(
      vault,
      "neiro_capture",
      { text: "From a tool", tags: ["tools"] },
      { push: true, author: "bot <bot@example.com>" },
    );
    expect(git(remote, "log", "-1", "--format=%an %s", "main")).toBe("bot chore: capture Inbox/From a tool.md");
    await call(vault, "neiro_prop_set", { note: "People/Plato.md", key: "rating", value: "5" }, { push: true });
    expect(readFileSync(join(root, "People", "Plato.md"), "utf8")).toContain("rating: 5");
    expect(git(remote, "log", "-1", "--format=%s", "main")).toBe("docs: set rating of People/Plato.md");
  });
});
