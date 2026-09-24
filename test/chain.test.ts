import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Chain } from "../src/chain.ts";
import { UnsupportedError, Vault } from "../src/index.ts";
import { parseToml } from "../src/providers.ts";

/** Run `read` with each provider of `chain` forced in turn, and return every output by provider name. */
async function eachProvider<T, R>(chain: Chain<T>, read: () => R | Promise<R>): Promise<Record<string, R>> {
  const outputs: Record<string, R> = {};
  try {
    for (const provider of chain.providers) {
      chain.force(provider.name);
      outputs[provider.name] = await read();
    }
  } finally {
    chain.force();
  }
  return outputs;
}

/** Every provider must return exactly what the last, portable provider returns. */
function expectIdentical<R>(outputs: Record<string, R>): void {
  const values = Object.values(outputs);
  for (const value of values) expect(value).toEqual(values[values.length - 1] as R);
}

describe("a chain", () => {
  const chain = new Chain<string>("greet", [
    { name: "absent", requires: "a thing this machine lacks", available: () => false, impl: "absent" },
    { name: "present", requires: "nothing", available: () => true, impl: "present" },
  ]);

  test("serves the first available provider, or the forced one", () => {
    expect(chain.get()).toBe("present");
    chain.force("absent");
    expect(chain.get()).toBe("absent");
    chain.force();
    expect(chain.get()).toBe("present");
    expect(() => chain.force("unknown")).toThrow("no provider named unknown");
  });

  test("names the capability and what each provider needs when none is available", () => {
    const none = new Chain("greet", [{ name: "absent", requires: "a thing", available: () => false, impl: "" }]);
    expect(() => none.get()).toThrow(UnsupportedError);
    expect(() => none.get()).toThrow("no provider can greet: absent needs a thing");
  });
});

describe("every provider returns the same result", () => {
  test("parse TOML, for neiro.toml and its title allowlist", async () => {
    const root = mkdtempSync(join(tmpdir(), "neiro-toml-"));
    writeFileSync(join(root, "casing.toml"), '[allow]\nwords = ["OpenAI", "iPhone"]\nmore = { names = ["GitHub"] }\n');
    writeFileSync(
      join(root, "neiro.toml"),
      [
        "[capture]",
        'folder = "Inbox"',
        'properties = ["title", "created", "tags"]',
        'values = { kind = "capture" }',
        'title_allowlist = "casing.toml"',
        "require_tags = true",
        "[journal.week]",
        'folder = "Weekly"',
        'format = "GGGG-[W]WW"',
      ].join("\n"),
    );
    const outputs = await eachProvider(parseToml, () => new Vault(root).settings);
    expectIdentical(outputs);
    expect(outputs["smol-toml"]?.capture.titleAllow).toEqual(["OpenAI", "iPhone", "GitHub"]);
  });
});

describe("portability", () => {
  test("reads frontmatter after a byte order mark", async () => {
    const root = mkdtempSync(join(tmpdir(), "neiro-bom-"));
    writeFileSync(join(root, "note.md"), "\uFEFF---\ntitle: Marked\n---\n\nBody\n");
    expect((await new Vault(root).find("note")).title).toBe("Marked");
  });

  test("uses Bun-only APIs only in chain providers", () => {
    const src = join(import.meta.dir, "..", "src");
    const offenders = readdirSync(src)
      .filter((file) => file !== "providers.ts" && /\bBun\./.test(readFileSync(join(src, file), "utf8")))
      .sort();
    expect(offenders).toEqual([]);
  });
});
