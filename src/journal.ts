export type Period = "week" | "month";

/** Vault-relative path templates. `{isoYear}` and `{ww}` come from the ISO week; `{yyyy}` and `{mm}` from the calendar. */
export interface JournalLayout {
  week: string;
  month: string;
}

export const DEFAULT_JOURNAL_LAYOUT: JournalLayout = {
  week: "journal/{isoYear}/weekly/{isoYear}-w{ww}.md",
  month: "journal/{yyyy}/monthly/{yyyy}-{mm}.md",
};

/** ISO-8601 week: weeks start on Monday, and week 1 contains the year's first Thursday. */
export function isoWeek(date: Date): { isoYear: number; week: number } {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const isoYear = day.getUTCFullYear();
  const week = Math.ceil(((day.getTime() - Date.UTC(isoYear, 0, 1)) / 86_400_000 + 1) / 7);
  return { isoYear, week };
}

export function journalPath(period: Period, date: Date, layout: JournalLayout = DEFAULT_JOURNAL_LAYOUT): string {
  const { isoYear, week } = isoWeek(date);
  const values: Record<string, string> = {
    isoYear: String(isoYear),
    ww: String(week).padStart(2, "0"),
    yyyy: String(date.getFullYear()),
    mm: String(date.getMonth() + 1).padStart(2, "0"),
  };
  return layout[period].replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

/** Parse `YYYY-MM-DD` as a local calendar date. */
export function parseDate(text: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error(`expected a date as YYYY-MM-DD, got "${text}"`);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getMonth() !== Number(match[2]) - 1) throw new Error(`not a calendar date: "${text}"`);
  return date;
}
