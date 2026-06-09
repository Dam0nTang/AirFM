import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app";

describe("profile API", () => {
  it("returns profile file content", async () => {
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [{ query: "A", reason: "fits" }],
          reason: "ok"
        })
      },
      tts: { synthesize: async () => "/.cache/tts/a.mp3" },
      music: { resolve: async () => undefined }
    });

    const response = await app.inject({ method: "GET", url: "/api/taste" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty("taste");

    await app.close();
  });
});
