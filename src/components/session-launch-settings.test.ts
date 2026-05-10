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

  it("treats empty text as explicit empty defaults", () => {
    expect(parseSessionLaunchCliArgsText(" \n")).toEqual([]);
  });

  it("rejects resume and shell-style tokens", () => {
    expect(() => parseSessionLaunchCliArgsText("--resume=abc")).toThrow(/--resume/);
    expect(() => parseSessionLaunchCliArgsText("--model gpt-5.5")).toThrow(/one option token per line/);
    expect(() => parseSessionLaunchCliArgsText("kickoff prompt")).toThrow(/one option token per line|option tokens/);
  });
});
