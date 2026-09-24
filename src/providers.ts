/** The capability chains. Bun-only APIs are used here and nowhere else in src/. */
import { parse as smolToml } from "smol-toml";
import { parse } from "yaml";
import { Chain } from "./chain.ts";

const onBun = () => typeof Bun !== "undefined";

export const parseToml = new Chain<(text: string) => unknown>("parse TOML", [
  { name: "Bun.TOML", requires: "the Bun runtime", available: onBun, impl: (text) => Bun.TOML.parse(text) },
  { name: "smol-toml", requires: "nothing", available: () => true, impl: smolToml },
]);

// Where Bun.YAML and `yaml` disagree: flow mappings (and so unquoted `{{placeholders}}`), merge keys, explicit tags and
// keys, and directives. A block with any of these, or with a key written twice, goes to `yaml`.
const BUN_YAML_DIVERGES = /\{|<<|(?:^|[\s[,])!|^\s*\?|^%/m;
const BLOCK_KEY = /^[ \t-]*(?:"([^"]*)"|'([^']*)'|(\S.*?))[ \t]*:(?:[ \t]|$)/gm;

function repeatsKey(text: string): boolean {
  const seen = new Set<string>();
  for (const match of text.matchAll(BLOCK_KEY)) {
    const key = match[1] ?? match[2] ?? match[3] ?? "";
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

export const parseYaml = new Chain<(text: string) => unknown>("parse YAML", [
  {
    name: "Bun.YAML",
    requires: "the Bun runtime",
    available: onBun,
    impl: (text) => (BUN_YAML_DIVERGES.test(text) || repeatsKey(text) ? yaml(text) : Bun.YAML.parse(text)),
  },
  { name: "yaml", requires: "nothing", available: () => true, impl: yaml },
]);

// Templates often hold unquoted placeholders such as `{{date}}`, which YAML reads as mappings; parse them quietly.
function yaml(text: string): unknown {
  return parse(text, { logLevel: "error" });
}
