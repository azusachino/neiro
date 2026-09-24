/**
 * The subset of moment.js format tokens that Obsidian's Daily Notes and the Periodic Notes plugin use for note
 * paths. Week-based tokens follow moment's defaults: `gggg`/`ww` use the English locale (weeks start on Sunday and
 * week 1 contains January 1), and `GGGG`/`WW` use ISO-8601 (weeks start on Monday and week 1 contains the year's
 * first Thursday). Text in square brackets is literal, as in moment.
 */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TOKEN =
  /\[[^\]]*\]|YYYY|YY|Q|MMMM|MMM|MM|M|DDDD|DDD|Do|DD|D|dddd|ddd|d|gggg|gg|ww|w|GGGG|GG|WW|W|HH|H|hh|h|mm|m|ss|s|A|a/g;

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

function dayOfYear(date: Date): number {
  return (
    Math.round(
      (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 1)) / 86_400_000,
    ) + 1
  );
}

function shifted(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** ISO-8601 week: weeks start on Monday, and week 1 contains the year's first Thursday. */
export function isoWeek(date: Date): { year: number; week: number } {
  const thursday = shifted(date, 4 - (date.getDay() || 7));
  return { year: thursday.getFullYear(), week: Math.ceil(dayOfYear(thursday) / 7) };
}

/** moment's English-locale week: weeks start on Sunday, and week 1 contains January 1. */
export function localeWeek(date: Date): { year: number; week: number } {
  const saturday = shifted(date, 6 - date.getDay());
  return { year: saturday.getFullYear(), week: Math.ceil(dayOfYear(saturday) / 7) };
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export function formatDate(date: Date, format: string): string {
  const iso = isoWeek(date);
  const locale = localeWeek(date);
  const hours12 = date.getHours() % 12 || 12;
  const tokens: Record<string, () => string> = {
    YYYY: () => pad(date.getFullYear(), 4),
    YY: () => pad(date.getFullYear() % 100),
    Q: () => String(Math.floor(date.getMonth() / 3) + 1),
    MMMM: () => MONTHS[date.getMonth()] as string,
    MMM: () => (MONTHS[date.getMonth()] as string).slice(0, 3),
    MM: () => pad(date.getMonth() + 1),
    M: () => String(date.getMonth() + 1),
    DDDD: () => pad(dayOfYear(date), 3),
    DDD: () => String(dayOfYear(date)),
    Do: () => ordinal(date.getDate()),
    DD: () => pad(date.getDate()),
    D: () => String(date.getDate()),
    dddd: () => DAYS[date.getDay()] as string,
    ddd: () => (DAYS[date.getDay()] as string).slice(0, 3),
    d: () => String(date.getDay()),
    gggg: () => pad(locale.year, 4),
    gg: () => pad(locale.year % 100),
    ww: () => pad(locale.week),
    w: () => String(locale.week),
    GGGG: () => pad(iso.year, 4),
    GG: () => pad(iso.year % 100),
    WW: () => pad(iso.week),
    W: () => String(iso.week),
    HH: () => pad(date.getHours()),
    H: () => String(date.getHours()),
    hh: () => pad(hours12),
    h: () => String(hours12),
    mm: () => pad(date.getMinutes()),
    m: () => String(date.getMinutes()),
    ss: () => pad(date.getSeconds()),
    s: () => String(date.getSeconds()),
    A: () => (date.getHours() < 12 ? "AM" : "PM"),
    a: () => (date.getHours() < 12 ? "am" : "pm"),
  };
  return format.replace(TOKEN, (token) => (token.startsWith("[") ? token.slice(1, -1) : (tokens[token]?.() ?? token)));
}

/** Parse `YYYY-MM-DD` as a local calendar date. */
export function parseDate(text: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error(`expected a date as YYYY-MM-DD, got "${text}"`);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getMonth() !== Number(match[2]) - 1) throw new Error(`not a calendar date: "${text}"`);
  return date;
}
