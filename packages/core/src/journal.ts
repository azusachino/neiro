import { posix } from "node:path";
import { formatDate } from "./dateformat.ts";
import { type Period, type PeriodicSetting, UnsupportedError } from "./settings.ts";

/** The vault-relative path of the periodic note for `date`, e.g. `Daily/2026-09-16.md`. */
export function journalPath(period: Period, date: Date, setting: PeriodicSetting | undefined): string {
  if (!setting) {
    throw new UnsupportedError(
      `no ${period} journal settings: set [journal.${period}] folder and format in tsuzuri.toml`,
    );
  }
  const relative = posix.normalize(posix.join(setting.folder, `${formatDate(date, setting.format)}.md`));
  return relative.replace(/^(\.\/)+/, "");
}
