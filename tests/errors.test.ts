import { expect, test } from "bun:test";
import {
  CaptureError,
  ConfigError,
  InputError,
  LineRangeError,
  NotFoundError,
  parseDate,
  SectionError,
  TsuzuriError,
  UnsupportedError,
  WriteConflictError,
} from "tsuzuri";

test("every error tsuzuri raises is a TsuzuriError named after its class", () => {
  const classes = [
    CaptureError,
    ConfigError,
    InputError,
    LineRangeError,
    NotFoundError,
    SectionError,
    UnsupportedError,
    WriteConflictError,
  ];
  for (const ErrorClass of classes) {
    const error = new ErrorClass("x");
    expect(error).toBeInstanceOf(TsuzuriError);
    expect(error.name).toBe(ErrorClass.name);
  }
  expect(() => parseDate("2026-13-01")).toThrow(InputError);
});
