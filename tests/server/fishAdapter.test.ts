import { describe, expect, it } from "vitest";
import { createFishTtsRequest } from "../../src/server/tts/fishAdapter";

describe("Fish Audio adapter", () => {
  it("builds a documented mp3 TTS request", () => {
    const request = createFishTtsRequest("key", "voice-id", "hello");

    expect(request.url).toBe("https://api.fish.audio/v1/tts");
    expect(request.init.method).toBe("POST");
    expect(request.init.headers).toMatchObject({
      Authorization: "Bearer key",
      "Content-Type": "application/json",
      model: "s2-pro"
    });
    expect(JSON.parse(String(request.init.body))).toEqual({
      text: "hello",
      reference_id: "voice-id",
      format: "mp3"
    });
  });

  it("attaches a proxy dispatcher when fish proxy is configured", () => {
    const request = createFishTtsRequest("key", "voice-id", "hello", "http://127.0.0.1:7897");

    expect(request.init.dispatcher).toBeDefined();
  });
});
