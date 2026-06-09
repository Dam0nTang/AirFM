import { describe, expect, it } from "vitest";
import { buildFmQueue, buildPlaybackQueue } from "../../src/server/playback/queue";

describe("playback queue", () => {
  it("places DJ voice before resolved songs", async () => {
    const queue = await buildPlaybackQueue({
      plan: {
        say: "Here is a focused set.",
        reason: "Focus request",
        play: [{ query: "Song A Artist A", reason: "steady mood" }]
      },
      tts: { synthesize: async () => "/.cache/tts/intro.mp3" },
      music: {
        resolve: async () => ({
          title: "Song A",
          artist: "Artist A",
          url: "https://music.example/a.mp3",
          source: "netease"
        })
      }
    });

    expect(queue[0].kind).toBe("voice");
    expect(queue[1].kind).toBe("song");
    expect(queue[1].title).toBe("Song A");
  });

  it("keeps unavailable recommendations when music resolution throws", async () => {
    const queue = await buildPlaybackQueue({
      plan: {
        say: "Here is a focused set.",
        reason: "Focus request",
        play: [{ query: "Song A Artist A", title: "Song A", artist: "Artist A", reason: "steady mood" }]
      },
      tts: { synthesize: async () => "/.cache/tts/intro.mp3" },
      music: {
        resolve: async () => {
          throw new Error("connect ECONNREFUSED 127.0.0.1:3001");
        }
      }
    });

    expect(queue).toHaveLength(2);
    expect(queue[0].kind).toBe("voice");
    expect(queue[0].text).toBe("Here is a focused set.");
    expect(queue[1]).toMatchObject({
      kind: "song",
      title: "Song A",
      artist: "Artist A",
      reason: "steady mood · Netease returned no playable audio"
    });
    expect(queue[1].url).toBeUndefined();
  });

  it("starts chat voice synthesis and song resolution concurrently", async () => {
    let finishVoice: ((url: string) => void) | undefined;
    const started: string[] = [];
    const queuePromise = buildPlaybackQueue({
      plan: {
        say: "Here is a focused set.",
        reason: "Focus request",
        play: [{ query: "Song A Artist A", title: "Song A", artist: "Artist A", reason: "steady mood" }]
      },
      tts: {
        synthesize: async () => {
          started.push("tts");
          return new Promise<string>((resolve) => {
            finishVoice = resolve;
          });
        }
      },
      music: {
        resolve: async (request) => {
          started.push("music");
          return {
            title: request.title ?? request.query,
            artist: request.artist,
            url: `https://music.example/${request.query}.mp3`,
            source: "netease"
          };
        }
      }
    });

    await Promise.resolve();
    const startedBeforeVoiceFinished = [...started];
    finishVoice?.("/.cache/tts/intro.mp3");
    await queuePromise;

    expect(startedBeforeVoiceFinished).toEqual(["tts", "music"]);
  });

  it("interleaves FM segues before each resolved song", async () => {
    const queue = await buildFmQueue({
      program: {
        title: "Late Night Claudio",
        reason: "night routine",
        segments: [
          {
            intro: "First segue",
            track: {
              query: "If Bread",
              title: "If",
              artist: "Bread",
              reason: "soft late night classic"
            }
          },
          {
            intro: "Second segue",
            track: {
              query: "Dreams Fleetwood Mac",
              title: "Dreams",
              artist: "Fleetwood Mac",
              reason: "warm groove"
            }
          }
        ]
      },
      tts: { synthesize: async (text) => `/.cache/tts/${text}.mp3` },
      music: {
        resolve: async (request) => ({
          title: request.title ?? request.query,
          artist: request.artist,
          url: `https://music.example/${request.query}.mp3`,
          source: "netease"
        })
      }
    });

    expect(queue.map((item) => item.kind)).toEqual(["voice", "song", "voice", "song"]);
    expect(queue[0]).toMatchObject({ title: "FM Segue 1", text: "First segue", fmRole: "segue", segmentIndex: 0 });
    expect(queue[1]).toMatchObject({ title: "If", artist: "Bread", fmRole: "song", segmentIndex: 0 });
    expect(queue[2]).toMatchObject({ title: "FM Segue 2", text: "Second segue", fmRole: "segue", segmentIndex: 1 });
    expect(queue[3]).toMatchObject({ title: "Dreams", artist: "Fleetwood Mac", fmRole: "song", segmentIndex: 1 });
  });

  it("starts initial FM voice synthesis and song resolution concurrently", async () => {
    let finishVoice: ((url: string) => void) | undefined;
    const started: string[] = [];
    const queuePromise = buildFmQueue({
      program: {
        title: "Late Morning AirFM",
        reason: "morning routine",
        segments: [
          {
            intro: "First segue",
            track: {
              query: "If Bread",
              title: "If",
              artist: "Bread",
              reason: "soft classic"
            }
          }
        ]
      },
      initialSongResolveLimit: 1,
      initialVoiceSynthesisLimit: 1,
      tts: {
        synthesize: async () => {
          started.push("tts");
          return new Promise<string>((resolve) => {
            finishVoice = resolve;
          });
        }
      },
      music: {
        resolve: async (request) => {
          started.push("music");
          return {
            title: request.title ?? request.query,
            artist: request.artist,
            url: `https://music.example/${request.query}.mp3`,
            source: "netease"
          };
        }
      }
    });

    await Promise.resolve();
    const startedBeforeVoiceFinished = [...started];
    finishVoice?.("/.cache/tts/segue.mp3");
    await queuePromise;

    expect(startedBeforeVoiceFinished).toEqual(["tts", "music"]);
  });

  it("starts multiple initial FM segments without waiting for the previous segment to finish", async () => {
    let finishFirstVoice: ((url: string) => void) | undefined;
    const started: string[] = [];
    const queuePromise = buildFmQueue({
      program: {
        title: "Late Morning AirFM",
        reason: "morning routine",
        segments: [
          {
            intro: "First segue",
            track: {
              query: "If Bread",
              title: "If",
              artist: "Bread",
              reason: "soft classic"
            }
          },
          {
            intro: "Second segue",
            track: {
              query: "Dreams Fleetwood Mac",
              title: "Dreams",
              artist: "Fleetwood Mac",
              reason: "warm groove"
            }
          }
        ]
      },
      initialSongResolveLimit: 2,
      initialVoiceSynthesisLimit: 2,
      tts: {
        synthesize: async (text) => {
          started.push(`tts:${text}`);
          if (text !== "First segue") {
            return `/.cache/tts/${text}.mp3`;
          }

          return new Promise<string>((resolve) => {
            finishFirstVoice = resolve;
          });
        }
      },
      music: {
        resolve: async (request) => {
          started.push(`music:${request.query}`);
          return {
            title: request.title ?? request.query,
            artist: request.artist,
            url: `https://music.example/${request.query}.mp3`,
            source: "netease"
          };
        }
      }
    });

    await Promise.resolve();
    const startedBeforeVoicesFinished = [...started];
    finishFirstVoice?.("/.cache/tts/0.mp3");
    await queuePromise;

    expect(startedBeforeVoicesFinished).toEqual([
      "tts:First segue",
      "music:If Bread",
      "tts:Second segue",
      "music:Dreams Fleetwood Mac"
    ]);
  });

  it("retries FM segue TTS before marking the voice unavailable", async () => {
    let ttsCalls = 0;
    const queue = await buildFmQueue({
      program: {
        title: "Late Night Claudio",
        reason: "night routine",
        segments: [
          {
            intro: "First segue",
            track: {
              query: "If Bread",
              title: "If",
              artist: "Bread",
              reason: "soft late night classic"
            }
          }
        ]
      },
      tts: {
        synthesize: async () => {
          ttsCalls += 1;
          if (ttsCalls === 1) {
            throw new Error("temporary Fish Audio failure");
          }
          return "/.cache/tts/retried.mp3";
        }
      },
      music: {
        resolve: async (request) => ({
          title: request.title ?? request.query,
          artist: request.artist,
          url: `https://music.example/${request.query}.mp3`,
          source: "netease"
        })
      }
    });

    expect(ttsCalls).toBe(2);
    expect(queue[0]).toMatchObject({
      kind: "voice",
      url: "/.cache/tts/retried.mp3"
    });
  });
});
