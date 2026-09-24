/** The capability chains. Bun-only APIs are used here and nowhere else in src/. */
import { parse as smolToml } from "smol-toml";
import { Chain } from "./chain.ts";

const onBun = () => typeof Bun !== "undefined";

export const parseToml = new Chain<(text: string) => unknown>("parse TOML", [
  { name: "Bun.TOML", requires: "the Bun runtime", available: onBun, impl: (text) => Bun.TOML.parse(text) },
  { name: "smol-toml", requires: "nothing", available: () => true, impl: smolToml },
]);
