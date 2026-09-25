import { expect, test } from "bun:test";
import {
  CaptureError,
  ConfigError,
  InputError,
  LineRangeError,
  NeiroError,
  NotFoundError,
  parseDate,
  SectionError,
  UnsupportedError,
  WriteConflictError,
} from "../src/index.ts";

test("every error neiro raises is a NeiroError named after its class", () => {
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
    expect(error).toBeInstanceOf(NeiroError);
    expect(error.name).toBe(ErrorClass.name);
  }
  expect(() => parseDate("2026-13-01")).toThrow(InputError);
});
