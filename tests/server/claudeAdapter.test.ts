import { describe, expect, it } from "vitest";
import {
  parseClaudeFmProgramOutput,
  parseClaudeIntentOutput,
  parseClaudePlanOutput,
  parseClaudeSongInfoOutput
} from "../../src/server/agent/claudeAdapter";

describe("Claude adapter output parsing", () => {
  it("parses a direct agent plan JSON object", () => {
    const plan = parseClaudePlanOutput(
      JSON.stringify({
        say: "Intro",
        play: [{ query: "Song A", reason: "fits" }],
        reason: "ok"
      })
    );

    expect(plan.say).toBe("Intro");
    expect(plan.play[0].query).toBe("Song A");
  });

  it("parses Claude CLI result wrappers with stringified JSON content", () => {
    const plan = parseClaudePlanOutput(
      JSON.stringify({
        type: "result",
        result: JSON.stringify({
          say: "Wrapped intro",
          play: [{ query: "Song B", reason: "warm" }],
          reason: "wrapped ok"
        })
      })
    );

    expect(plan.say).toBe("Wrapped intro");
    expect(plan.play[0].reason).toBe("warm");
  });

  it("parses JSON wrapped in markdown code fences", () => {
    const plan = parseClaudePlanOutput(`\`\`\`json
{
  "say": "Fenced intro",
  "play": [
    {
      "query": "Song C",
      "reason": "soft focus"
    }
  ],
  "reason": "fenced ok"
}
\`\`\``);

    expect(plan.say).toBe("Fenced intro");
    expect(plan.play[0].query).toBe("Song C");
  });

  it("normalizes title and artist track objects into query fields", () => {
    const plan = parseClaudePlanOutput(
      JSON.stringify({
        say: "Object intro",
        play: [
          {
            title: "晴天",
            artist: "周杰伦",
            why: "旋律清爽，适合下午专注"
          }
        ],
        reason: "object ok"
      })
    );

    expect(plan.play[0]).toEqual({
      query: "晴天 周杰伦",
      title: "晴天",
      artist: "周杰伦",
      reason: "旋律清爽，适合下午专注"
    });
  });

  it("preserves genre metadata for downstream matching", () => {
    const plan = parseClaudePlanOutput(
      JSON.stringify({
        say: "Classic rock intro",
        play: [
          {
            title: "Hotel California",
            artist: "Eagles",
            genre: "classic rock",
            reason: "黄金年代的经典摇滚"
          }
        ],
        reason: "classic rock ok"
      })
    );

    expect(plan.play[0]).toMatchObject({
      query: "Hotel California Eagles",
      title: "Hotel California",
      artist: "Eagles",
      genre: "classic rock"
    });
  });

  it("normalizes string track entries into query fields", () => {
    const plan = parseClaudePlanOutput(
      JSON.stringify({
        say: "String intro",
        play: ["七里香 周杰伦"],
        reason: "string ok"
      })
    );

    expect(plan.play[0]).toEqual({
      query: "七里香 周杰伦",
      reason: "Selected by the radio plan"
    });
  });

  it("parses intent JSON for follow-up routing", () => {
    const intent = parseClaudeIntentOutput(
      JSON.stringify({
        result: {
          intent: "song_info",
          target: { reference: "index:2", title: "Hotel California", artist: "Eagles" },
          reason: "asks about a listed song"
        }
      })
    );

    expect(intent).toEqual({
      intent: "song_info",
      target: { reference: "index:2", title: "Hotel California", artist: "Eagles" },
      reason: "asks about a listed song"
    });
  });

  it("parses song info JSON for DJ explanations", () => {
    const info = parseClaudeSongInfoOutput(
      JSON.stringify({
        content: JSON.stringify({
          say: "这首歌来自黄金年代的摇滚语境。",
          reason: "answers background"
        })
      })
    );

    expect(info.say).toContain("黄金年代");
  });

  it("parses FM JSON when Claude prefixes it with prose", () => {
    const program = parseClaudeFmProgramOutput(`Here is the FM program:
{
  "title": "Morning AirFM",
  "reason": "fits the current morning",
  "segments": [
    {
      "intro": "Good morning, here is If by Bread.",
      "track": {
        "title": "If",
        "artist": "Bread",
        "genre": "soft rock",
        "query": "If Bread",
        "reason": "gentle morning song"
      }
    }
  ]
}`);

    expect(program.title).toBe("Morning AirFM");
    expect(program.segments[0].track.query).toBe("If Bread");
  });
});
