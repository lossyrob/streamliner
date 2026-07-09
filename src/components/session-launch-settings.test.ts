import { describe, expect, it } from "vitest";

import {
  formatSessionLaunchCliArgsText,
  parseSessionLaunchCliArgsText,
} from "./session-launch-settings";

describe("session launch settings helpers", () => {
  it("formats and parses one option token per line", () => {
    const text = formatSessionLaunchCliArgsText(["--yolo", "--model=gpt-5.5"]);
    expect(text).toBe("--yolo\n--model=gpt-5.5");
    expect(parseSessionLaunchCliArgsText(text)).toEqual(["--yolo", "--model=gpt-5.5"]);
  });

  it("formats and parses prefer-version as a separated option value", () => {
    const text = formatSessionLaunchCliArgsText([
      "--yolo",
      "--prefer-version",
      "1.0.52-config-hardening-patch",
    ]);
    expect(text).toBe("--yolo\n--prefer-version 1.0.52-config-hardening-patch");
    expect(parseSessionLaunchCliArgsText(text)).toEqual([
      "--yolo",
      "--prefer-version",
      "1.0.52-config-hardening-patch",
    ]);
  });

  it("normalizes legacy prefer-version equals form to separated argv tokens", () => {
    expect(parseSessionLaunchCliArgsText("--prefer-version=1.0.52-config-hardening-patch")).toEqual([
      "--prefer-version",
      "1.0.52-config-hardening-patch",
    ]);
  });

  it("treats empty text as explicit empty defaults", () => {
    expect(parseSessionLaunchCliArgsText(" \n")).toEqual([]);
  });

  it("rejects resume and shell-style tokens", () => {
    expect(() => parseSessionLaunchCliArgsText("--resume=abc")).toThrow(/--resume/);
    expect(() => parseSessionLaunchCliArgsText("--model gpt-5.5")).toThrow(/option tokens/);
    expect(() => parseSessionLaunchCliArgsText("kickoff prompt")).toThrow(/option tokens/);
    expect(() => parseSessionLaunchCliArgsText("--prefer-version")).toThrow(/requires a value/);
  });
});
