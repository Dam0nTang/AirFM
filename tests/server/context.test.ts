import { describe, expect, it } from "vitest";
import {
  buildContextPrompt,
  buildFmContinuationPrompt,
  buildFmFirstSegmentPrompt
} from "../../src/server/context/contextBuilder";

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

  it("builds an FM first-segment prompt constrained to one segment", () => {
    const prompt = buildFmFirstSegmentPrompt({
      persona: "You are AirFM.",
      profile: {
        taste: "Likes warm vocals.",
        routines: "Works at 10:00.",
        playlists: "{}",
        moodRules: "morning means bright songs"
      },
      now: new Date("2026-06-06T10:15:00+08:00"),
      recentPlays: []
    });

    expect(prompt).toContain("Generate exactly 1 segment");
    expect(prompt).toContain("\"segments\"");
    expect(prompt).toContain("query");
    expect(prompt).toContain("exact song title and artist");
  });

  it("builds an FM continuation prompt with program context and avoid tracks", () => {
    const prompt = buildFmContinuationPrompt({
      persona: "You are AirFM.",
      profile: {
        taste: "Likes warm vocals.",
        routines: "Works at 10:00.",
        playlists: "{}",
        moodRules: "morning means bright songs"
      },
      now: new Date("2026-06-06T10:15:00+08:00"),
      recentPlays: [],
      program: {
        title: "Morning Drift",
        reason: "gentle start",
        lastTrack: { title: "Song 1", artist: "Artist" },
        plannedTracks: [{ title: "Song 1", artist: "Artist", query: "Song 1 Artist" }]
      },
      conversation: [{ role: "dj", text: "We started soft and warm." }],
      avoidTracks: [{ title: "Song 1", artist: "Artist" }]
    });

    expect(prompt).toContain("Continue the existing FM radio program");
    expect(prompt).toContain("Morning Drift");
    expect(prompt).toContain("Song 1 / Artist");
    expect(prompt).toContain("dj: We started soft and warm.");
    expect(prompt).toContain("Generate 3 to 5 segments");
    expect(prompt).toContain("Do not repeat");
  });
});
