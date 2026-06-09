import { describe, expect, it } from "vitest";
import { buildContextPrompt } from "../../src/server/context/contextBuilder";

describe("context builder", () => {
  it("combines persona, user profile, time, history, and prompt", () => {
    const prompt = buildContextPrompt({
      persona: "You are a calm DJ.",
      profile: {
        taste: "Likes warm vocals.",
        routines: "Works at 14:00.",
        playlists: "{\"focus\":[\"A\"]}",
        moodRules: "focus means low distraction"
      },
      now: new Date("2026-06-06T14:00:00+08:00"),
      recentPlays: [{ title: "Old Song", artist: "Someone" }],
      userPrompt: "play focus music",
      conversation: [
        { role: "user", text: "make it lighter" },
        { role: "dj", text: "I'll soften the next set." }
      ],
      avoidTracks: [{ title: "42", artist: "迪诺哥" }]
    });

    expect(prompt).toContain("You are a calm DJ.");
    expect(prompt).toContain("Likes warm vocals.");
    expect(prompt).toContain("Old Song / Someone");
    expect(prompt).toContain("play focus music");
    expect(prompt).toContain("user: make it lighter");
    expect(prompt).toContain("dj: I'll soften the next set.");
    expect(prompt).toContain("42 / 迪诺哥");
  });

  it("uses local display time guidance instead of UTC-only time for time-of-day wording", () => {
    const prompt = buildContextPrompt({
      persona: "You are a calm DJ.",
      profile: {
        taste: "Likes warm vocals.",
        routines: "Works at 10:00.",
        playlists: "{}",
        moodRules: "morning means bright songs"
      },
      now: new Date("2026-06-06T10:15:00+08:00"),
      recentPlays: [],
      userPrompt: "start the day"
    });

    expect(prompt).toContain("Local display time:");
    expect(prompt).toContain("Time-of-day words must match the local display time");
    expect(prompt).not.toContain("Time: 2026-06-06T02:15:00.000Z");
  });
});
