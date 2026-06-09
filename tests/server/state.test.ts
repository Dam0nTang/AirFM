import { describe, expect, it } from "vitest";
import { createDatabase } from "../../src/server/state/db";
import { createRepository } from "../../src/server/state/repository";

describe("state repository", () => {
  it("persists plans and playback events", () => {
    const db = createDatabase(":memory:");
    const repo = createRepository(db);

    const planId = repo.savePlan({
      prompt: "focus music",
      say: "Let's ease into focus.",
      reason: "User asked for focus.",
      raw: { say: "Let's ease into focus.", play: [] }
    });
    repo.savePlay({
      planId,
      kind: "voice",
      title: "Intro",
      url: "/cache/tts/a.mp3",
      reason: "DJ intro"
    });

    expect(repo.getLatestPlan()?.id).toBe(planId);
    expect(repo.listRecentPlays(5)).toHaveLength(1);
  });
});
