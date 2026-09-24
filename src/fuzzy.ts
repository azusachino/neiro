/**
 * Fuzzy matching with fzf's scoring rules (its v2 algorithm), in neiro's own code. A query matches a text when its
 * characters appear in order; the best alignment wins, rewarding word starts, path separators, camelCase humps, and
 * runs of consecutive characters, and penalizing gaps.
 */

const SCORE_MATCH = 16;
const GAP_START = -3;
const GAP_EXTENSION = -1;
const BONUS_BOUNDARY = SCORE_MATCH / 2;
const BONUS_NON_WORD = SCORE_MATCH / 2;
const BONUS_CAMEL = BONUS_BOUNDARY + GAP_EXTENSION;
const BONUS_CONSECUTIVE = -(GAP_START + GAP_EXTENSION);
const BONUS_BOUNDARY_WHITE = BONUS_BOUNDARY + 2;
const BONUS_BOUNDARY_DELIMITER = BONUS_BOUNDARY + 1;
const FIRST_CHAR_MULTIPLIER = 2;

type CharClass = "white" | "delimiter" | "nonword" | "lower" | "upper" | "number" | "cjk" | "letter";

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function charClass(char: string | undefined): CharClass {
  if (char === undefined || /\s/u.test(char)) return "white";
  if ("/,:;|".includes(char)) return "delimiter";
  if (/[0-9]/.test(char)) return "number";
  if (/[a-z]/.test(char)) return "lower";
  if (/[A-Z]/.test(char)) return "upper";
  if (CJK.test(char)) return "cjk";
  if (/[\p{L}\p{N}]/u.test(char)) return "letter";
  return "nonword";
}

/** fzf's bonus for matching a character of class `current` right after one of class `previous`. */
function bonusFor(previous: CharClass, current: CharClass): number {
  const word = current !== "white" && current !== "delimiter" && current !== "nonword";
  if (word) {
    if (previous === "white") return BONUS_BOUNDARY_WHITE;
    if (previous === "delimiter") return BONUS_BOUNDARY_DELIMITER;
    if (previous === "nonword") return BONUS_BOUNDARY;
    // CJK has no spaces, so its first character after other text starts a word.
    if (current === "cjk" && previous !== "cjk") return BONUS_BOUNDARY;
  }
  if ((previous === "lower" && current === "upper") || (previous !== "number" && current === "number")) {
    return BONUS_CAMEL;
  }
  return current === "nonword" || current === "delimiter" ? BONUS_NON_WORD : 0;
}

function normalize(text: string, caseSensitive: boolean): string[] {
  const folded = text.normalize("NFKC");
  return [...(caseSensitive ? folded : folded.toLowerCase())];
}

/** The best alignment score of `term` inside `text`, or `null` when its characters do not all appear in order. */
export function fuzzyScore(term: string, text: string): number | null {
  const caseSensitive = /\p{Lu}/u.test(term);
  const query = normalize(term, caseSensitive);
  const chars = normalize(text, caseSensitive);
  const original = [...text.normalize("NFKC")];
  if (query.length === 0 || query.length > chars.length) return null;
  // Most texts do not contain the query in order at all; reject them before the full alignment, as fzf does.
  let next = 0;
  for (const char of chars) if (char === query[next] && ++next === query.length) break;
  if (next < query.length) return null;
  const bonus = chars.map((_, j) => bonusFor(charClass(original[j - 1]), charClass(original[j])));

  // previous[j]: best score with the previous query character matched at j; runBonus[j]: the bonus of the first
  // character of the consecutive run ending there, which fzf extends to every character of the run.
  let previous: number[] = [];
  let previousRun: number[] = [];
  for (let i = 0; i < query.length; i++) {
    const row = new Array<number>(chars.length).fill(Number.NEGATIVE_INFINITY);
    const runBonus = new Array<number>(chars.length).fill(0);
    let carry = Number.NEGATIVE_INFINITY;
    for (let j = 0; j < chars.length; j++) {
      if (i > 0 && j >= 2) carry = Math.max(carry + GAP_EXTENSION, (previous[j - 2] ?? -Infinity) + GAP_START);
      else if (i > 0) carry += GAP_EXTENSION;
      if (chars[j] !== query[i]) continue;
      const here = bonus[j] ?? 0;
      if (i === 0) {
        row[j] = SCORE_MATCH + here * FIRST_CHAR_MULTIPLIER;
        runBonus[j] = here;
        continue;
      }
      const inherited = previousRun[j - 1] ?? 0;
      const consecutive = (previous[j - 1] ?? -Infinity) + SCORE_MATCH + Math.max(here, inherited, BONUS_CONSECUTIVE);
      const afterGap = carry + SCORE_MATCH + here;
      if (consecutive >= afterGap) {
        row[j] = consecutive;
        runBonus[j] = Math.max(here, inherited);
      } else {
        row[j] = afterGap;
        runBonus[j] = here;
      }
    }
    previous = row;
    previousRun = runBonus;
  }
  const best = Math.max(...previous);
  return Number.isFinite(best) ? best : null;
}

export interface FuzzyCandidate<T> {
  item: T;
  /** Texts to match, such as a path, a title, and aliases; the best one counts. */
  texts: string[];
}

export interface FuzzyHit<T> {
  item: T;
  score: number;
  /** The text that matched best. */
  matched: string;
}

/**
 * Rank candidates by a query of space-separated terms, each of which must match one of a candidate's texts, as in
 * fzf's extended search; with `anyTerm`, a candidate needs only one matching term and scores the ones that match.
 * Ties go to the shorter matched text.
 */
export function fuzzyRank<T>(
  query: string,
  candidates: FuzzyCandidate<T>[],
  limit: number,
  options: { anyTerm?: boolean } = {},
): FuzzyHit<T>[] {
  const terms = query.trim().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return [];
  const hits: FuzzyHit<T>[] = [];
  for (const { item, texts } of candidates) {
    let total = 0;
    let matched = "";
    let matchedScore = Number.NEGATIVE_INFINITY;
    for (const term of terms) {
      let termBest = Number.NEGATIVE_INFINITY;
      for (const text of texts) {
        const score = fuzzyScore(term, text);
        if (score === null) continue;
        if (score > termBest) termBest = score;
        if (score > matchedScore || (score === matchedScore && text.length < matched.length)) {
          matchedScore = score;
          matched = text;
        }
      }
      if (Number.isFinite(termBest)) {
        total += termBest;
      } else if (!options.anyTerm) {
        total = Number.NEGATIVE_INFINITY;
        break;
      }
    }
    if (Number.isFinite(total) && matched !== "") hits.push({ item, score: total, matched });
  }
  return hits.sort((a, b) => b.score - a.score || a.matched.length - b.matched.length).slice(0, limit);
}
