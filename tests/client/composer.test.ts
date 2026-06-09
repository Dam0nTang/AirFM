import { describe, expect, it } from "vitest";
import { shouldSubmitPrompt } from "../../src/client/player/composer";

describe("prompt composer", () => {
  it("submits on plain Enter", () => {
    expect(shouldSubmitPrompt({ key: "Enter" })).toBe(true);
  });

  it("does not submit while an IME composition is active", () => {
    expect(shouldSubmitPrompt({ key: "Enter", isComposing: true })).toBe(false);
    expect(shouldSubmitPrompt({ key: "Enter", nativeIsComposing: true })).toBe(false);
  });

  it("does not submit modified Enter shortcuts", () => {
    expect(shouldSubmitPrompt({ key: "Enter", shiftKey: true })).toBe(false);
    expect(shouldSubmitPrompt({ key: "Enter", altKey: true })).toBe(false);
    expect(shouldSubmitPrompt({ key: "Enter", ctrlKey: true })).toBe(false);
    expect(shouldSubmitPrompt({ key: "Enter", metaKey: true })).toBe(false);
  });
});
