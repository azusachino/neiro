import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TsuzuriError, Vault } from "tsuzuri";
import { agentTools, DEFAULT_EXPOSURE, TOOLS, ToolInputError, validateInput } from "tsuzuri/tools";
import { copyVault } from "./git.ts";

const tool = (name: string) => {
  const found = TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};
const call = (vault: Vault, name: string, input: Record<string, unknown>) =>
  tool(name).run(vault, validateInput(tool(name), input));

describe("tool definitions", () => {
  test("have unique names every tool-calling API accepts, and descriptions", () => {
    const names = TOOLS.map((definition) => definition.name);
    expect(new Set(names).size).toBe(names.length);
    for (const definition of TOOLS) {
      expect(definition.name).toMatch(/^tsuzuri_[a-z_]{1,58}$/);
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
      tsuzuri_capture: "direct",
      tsuzuri_append: "confirm",
      tsuzuri_section_put: "confirm",
      tsuzuri_prop_set: "confirm",
      tsuzuri_put: "cli-only",
    });
    const offered = agentTools().map((definition) => definition.name);
    expect(offered).not.toContain("tsuzuri_put");
    expect(offered).toContain("tsuzuri_get");
    const locked = agentTools({ ...DEFAULT_EXPOSURE, tsuzuri_capture: "cli-only" }).map(
      (definition) => definition.name,
    );
    expect(locked).not.toContain("tsuzuri_capture");
  });
});

describe("validateInput", () => {
  test("rejects missing, unknown, and mistyped inputs with clear messages", () => {
    expect(() => validateInput(tool("tsuzuri_get"), {})).toThrow("tsuzuri_get needs note");
    expect(() => validateInput(tool("tsuzuri_get"), { note: "x", bogus: 1 })).toThrow("has no input bogus");
    expect(() => validateInput(tool("tsuzuri_search"), { query: "x", limit: 0 })).toThrow(ToolInputError);
    expect(() => validateInput(tool("tsuzuri_list"), { sort: "size" })).toThrow("must be one of");
    expect(() => validateInput(tool("tsuzuri_capture"), { text: "x", tags: ["a", 2] })).toThrow("must be array");
    expect(() => validateInput(tool("tsuzuri_get"), "note")).toThrow("takes an object");
    expect(() => validateInput(tool("tsuzuri_list"), { where: { status: 3 } })).toThrow(
      "values must be string or null",
    );
    expect(validateInput(tool("tsuzuri_list"), { where: { status: "done", source: null } })).toBeDefined();
  });

  test("refuses a malformed line range instead of reading the whole note", async () => {
    const vault = new Vault(copyVault());
    await expect(call(vault, "tsuzuri_get", { note: "Home", lines: "abc:def" })).rejects.toThrow(ToolInputError);
    expect(await call(vault, "tsuzuri_get", { note: "Home", lines: "2" })).toMatchObject({ start: 2, end: 2 });
  });
});

describe("running tools", () => {
  test("reads go through the SDK", async () => {
    const vault = new Vault(copyVault());
    expect(await call(vault, "tsuzuri_get", { note: "clt", lines: "1:2" })).toMatchObject({ start: 1, end: 2 });
    expect(((await call(vault, "tsuzuri_find", { query: "wm" })) as { path: string }[])[0]?.path).toBe(
      "Topics/Working memory.md",
    );
    expect(await call(vault, "tsuzuri_list", { where: { born: "-428" } })).toMatchObject([{ path: "People/Plato.md" }]);
    expect(await call(vault, "tsuzuri_prop_get", { note: "People/Plato.md", key: "born" })).toBe(-428);
  });

  test("grep reads a model's pattern as literal text unless regex is set, and caps its length", async () => {
    const vault = new Vault(copyVault());
    const literal = (await call(vault, "tsuzuri_grep", { pattern: "load." })) as unknown[];
    const regex = (await call(vault, "tsuzuri_grep", { pattern: "load.", regex: true })) as unknown[];
    expect(regex.length).toBeGreaterThan(literal.length);
    await expect(call(vault, "tsuzuri_grep", { pattern: "x".repeat(201) })).rejects.toThrow(ToolInputError);
    await expect(call(vault, "tsuzuri_grep", { pattern: "(", regex: true })).rejects.toThrow(ToolInputError);
  });

  test("writes take the model's guards and change only the files", async () => {
    const root = copyVault();
    const vault = new Vault(root);
    const preview = (await call(vault, "tsuzuri_append", { note: "Home", text: "- x", dryRun: true })) as {
      diff: string;
    };
    expect(preview.diff).toContain("+- x");
    await call(vault, "tsuzuri_capture", { text: "From a tool", tags: ["tools"] });
    expect(readFileSync(join(root, "Inbox", "From a tool.md"), "utf8")).toContain("From a tool");
    await call(vault, "tsuzuri_prop_set", { note: "People/Plato.md", key: "rating", value: "5" });
    expect(readFileSync(join(root, "People", "Plato.md"), "utf8")).toContain("rating: 5");
  });
});

describe("the tsuzuri-tools command", () => {
  const CLI = join(import.meta.dir, "..", "src", "tools-cli.ts");
  const run = (...args: string[]) => spawnSync("bun", [CLI, ...args], { encoding: "utf8" });

  test("prints the definitions, the SDK's without run", () => {
    const { status, stdout } = run("--json");
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual(
      JSON.parse(JSON.stringify(TOOLS.map(({ run: _, ...definition }) => definition))),
    );
    expect(run().stdout).toContain("tsuzuri_capture\tdirect\tadds\t");
    expect(run("--bogus").status).toBe(2);
  });
});

test("a malformed call is a ToolInputError, and so a TsuzuriError", () => {
  const error = new ToolInputError("x");
  expect(error).toBeInstanceOf(TsuzuriError);
  expect(error.name).toBe("ToolInputError");
});
