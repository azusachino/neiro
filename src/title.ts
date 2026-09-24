const TOKEN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu;
const CJK = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}";
const LATIN_THEN_CJK = new RegExp(`([A-Za-z])([${CJK}])`, "gu");
const CJK_THEN_LATIN = new RegExp(`([${CJK}])([A-Za-z])`, "gu");

function allowed(token: string, allow: ReadonlySet<string> | null): boolean {
  // Without a vault allowlist, keep anything written in capitals, such as `API`.
  if (allow === null) return token.length > 1 && token === token.toUpperCase();
  if (allow.has(token)) return true;
  if (token.endsWith("'s") && allow.has(token.slice(0, -2))) return true;
  return token.endsWith("s") && allow.has(token.slice(0, -1));
}

/** Lowercase title words except allowlisted names, and space Latin text apart from CJK text. */
export function normalizeTitle(title: string, allow: ReadonlySet<string> | null): string {
  return title
    .replace(TOKEN, (token) => (allowed(token, allow) ? token : token.toLowerCase()))
    .replace(LATIN_THEN_CJK, "$1 $2")
    .replace(CJK_THEN_LATIN, "$1 $2");
}
