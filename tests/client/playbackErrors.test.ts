import { describe, expect, it } from "vitest";
import { isBenignPlaybackInterruption, isUnsupportedPlaybackSource } from "../../src/client/player/playbackErrors";

describe("playback error helpers", () => {
  it("recognizes browser play interruptions as benign", () => {
    expect(isBenignPlaybackInterruption(new DOMException("The play() request was interrupted by a call to pause().", "AbortError"))).toBe(true);
  });

  it("recognizes unsupported source playback failures", () => {
    expect(isUnsupportedPlaybackSource(new DOMException("The element has no supported sources.", "NotSupportedError"))).toBe(true);
  });

  it("does not treat unrelated errors as playback source errors", () => {
    expect(isUnsupportedPlaybackSource(new Error("network failed"))).toBe(false);
    expect(isBenignPlaybackInterruption(new DOMException("The element has no supported sources.", "NotSupportedError"))).toBe(false);
  });
});
