import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/server/app";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("radio API", () => {
  it("creates a queue from chat prompt", async () => {
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [{ query: "A", reason: "fits" }],
          reason: "ok"
        })
      },
      tts: { synthesize: async () => "/.cache/tts/a.mp3" },
      music: {
        resolve: async () => ({
          title: "A",
          artist: "B",
          url: "https://x/a.mp3",
          source: "netease"
        })
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { prompt: "focus" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().queue).toHaveLength(2);
    expect(response.json().state.messages).toHaveLength(2);
    expect(response.json().state.messages[1].recommendations).toHaveLength(1);

    await app.close();
  });

  it("returns a useful error message when planning fails", async () => {
    const app = await createApp({
      agent: {
        plan: async () => {
          throw new Error("Claude output was not valid radio JSON");
        }
      },
      tts: { synthesize: async () => "/.cache/tts/a.mp3" },
      music: { resolve: async () => undefined }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { prompt: "focus" }
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().message).toBe("Claude output was not valid radio JSON");

    await app.close();
  });

  it("does not auto-select playback after generating recommendations", async () => {
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [{ query: "A", reason: "fits" }],
          reason: "ok"
        })
      },
      tts: {
        synthesize: async () => {
          throw new Error("Fish Audio TTS failed");
        }
      },
      music: {
        resolve: async () => ({
          title: "A",
          artist: "B",
          url: "https://x/a.mp3",
          source: "netease"
        })
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { prompt: "focus" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().state.currentIndex).toBe(-1);
    expect(response.json().state.status).toBe("idle");

    await app.close();
  });

  it("attaches the DJ voice item to the DJ message for replay", async () => {
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [{ query: "A", reason: "fits" }],
          reason: "ok"
        })
      },
      tts: { synthesize: async () => "/.cache/tts/a.mp3" },
      music: {
        resolve: async () => ({
          title: "A",
          artist: "B",
          url: "https://x/a.mp3",
          source: "netease"
        })
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { prompt: "focus" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().state.messages[1].voice).toMatchObject({
      kind: "voice",
      title: "DJ Intro",
      url: "/.cache/tts/a.mp3"
    });

    await app.close();
  });

  it("treats the first user message as a recommendation without intent classification", async () => {
    let planCalls = 0;
    const app = await createApp({
      agent: {
        classify: async () => {
          throw new Error("classifier should not run for the first message");
        },
        plan: async () => {
          planCalls += 1;
          return {
            say: "Intro",
            play: [{ query: "A", reason: "fits" }],
            reason: "ok"
          };
        }
      },
      tts: { synthesize: async () => "/.cache/tts/a.mp3" },
      music: {
        resolve: async () => ({
          title: "A",
          artist: "B",
          url: "https://x/a.mp3",
          source: "netease"
        })
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { prompt: "focus" }
    });

    expect(response.statusCode).toBe(200);
    expect(planCalls).toBe(1);
    expect(response.json().queue).toHaveLength(2);

    await app.close();
  });

  it("answers follow-up song information questions without replacing the queue", async () => {
    let resolveCalls = 0;
    let explainCalls = 0;
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [{ query: "A", title: "Song A", artist: "Artist A", reason: "fits" }],
          reason: "ok"
        }),
        classify: async () => ({
          intent: "song_info",
          target: { reference: "index:1", title: "Song A", artist: "Artist A" },
          reason: "asks about a recommended song"
        }),
        explain: async () => {
          explainCalls += 1;
          return {
            say: "Song A was released in 1977 and has a warm classic rock sound.",
            reason: "song details"
          };
        }
      },
      tts: { synthesize: async (text) => `/.cache/tts/${encodeURIComponent(text)}.mp3` },
      music: {
        resolve: async () => {
          resolveCalls += 1;
          return {
            title: "Song A",
            artist: "Artist A",
            url: "https://x/a.mp3",
            source: "netease"
          };
        }
      }
    });

    const first = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { prompt: "play something" }
    });
    const originalQueue = first.json().queue;

    const followUp = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { prompt: "第一首歌是什么背景？" }
    });

    expect(followUp.statusCode).toBe(200);
    expect(explainCalls).toBe(1);
    expect(resolveCalls).toBe(1);
    expect(followUp.json().queue).toEqual(originalQueue);
    expect(followUp.json().state.messages.at(-1)).toMatchObject({
      role: "dj",
      text: "Song A was released in 1977 and has a warm classic rock sound."
    });
    expect(followUp.json().state.messages.at(-1).recommendations).toBeUndefined();
    expect(followUp.json().state.messages.at(-1).voice).toMatchObject({
      kind: "voice",
      url: expect.stringContaining("/.cache/tts/")
    });

    await app.close();
  });

  it("uses the current playing song when the user asks about the current track", async () => {
    let explainIntentTitle = "";
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [
            { query: "A", title: "Song A", artist: "Artist A", reason: "first" },
            { query: "B", title: "Song B", artist: "Artist B", reason: "second" }
          ],
          reason: "ok"
        }),
        classify: async () => ({
          intent: "song_info",
          target: { reference: "index:1", title: "Song A", artist: "Artist A" },
          reason: "asks about current song"
        }),
        explain: async (_prompt, _messages, _queue, intent) => {
          explainIntentTitle = intent.target?.title ?? "";
          return {
            say: `介绍 ${intent.target?.title}`,
            reason: "current song details"
          };
        }
      },
      tts: { synthesize: async () => "/.cache/tts/info.mp3" },
      music: {
        resolve: async (request) => ({
          title: request.title ?? request.query,
          artist: request.artist,
          url: `https://x/${request.query}.mp3`,
          source: "netease"
        })
      }
    });

    const first = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { prompt: "play something" }
    });
    const secondSongId = first.json().queue[2].id;
    await app.inject({ method: "POST", url: "/api/play", payload: { itemId: secondSongId } });

    const followUp = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { prompt: "介绍一下当前这首歌" }
    });

    expect(followUp.statusCode).toBe(200);
    expect(explainIntentTitle).toBe("Song B");
    expect(followUp.json().state.messages.at(-1).text).toBe("介绍 Song B");

    await app.close();
  });

  it("does not advance when next is requested for a stale queue item", async () => {
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [{ query: "A", reason: "fits" }],
          reason: "ok"
        })
      },
      tts: { synthesize: async () => "/.cache/tts/a.mp3" },
      music: {
        resolve: async () => ({
          title: "A",
          artist: "B",
          url: "https://x/a.mp3",
          source: "netease"
        })
      }
    });

    const chat = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { prompt: "focus" }
    });
    const before = chat.json().state;

    const response = await app.inject({
      method: "GET",
      url: "/api/next?itemId=old-item"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().currentIndex).toBe(before.currentIndex);

    await app.close();
  });

  it("selects a queue item for playback", async () => {
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [{ query: "A", reason: "fits" }],
          reason: "ok"
        })
      },
      tts: { synthesize: async () => "/.cache/tts/a.mp3" },
      music: {
        resolve: async () => ({
          title: "A",
          artist: "B",
          url: "https://x/a.mp3",
          source: "netease"
        })
      }
    });

    const chat = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { prompt: "focus" }
    });
    const songId = chat.json().queue[1].id;

    const response = await app.inject({
      method: "POST",
      url: "/api/play",
      payload: { itemId: songId }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().currentIndex).toBe(1);

    await app.close();
  });

  it("keeps unavailable song recommendations but rejects playing them", async () => {
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [{ query: "A", title: "A", artist: "B", reason: "fits" }],
          reason: "ok"
        })
      },
      tts: { synthesize: async () => "/.cache/tts/a.mp3" },
      music: { resolve: async () => undefined }
    });

    const chat = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { prompt: "focus" }
    });
    const unavailable = chat.json().queue[1];

    expect(unavailable).toMatchObject({
      kind: "song",
      title: "A",
      artist: "B"
    });
    expect(unavailable.url).toBeUndefined();

    const play = await app.inject({
      method: "POST",
      url: "/api/play",
      payload: { itemId: unavailable.id }
    });

    expect(play.statusCode).toBe(409);
    expect(play.json().message).toBe("Queue item is not playable");

    await app.close();
  });

  it("moves to the previous queue item", async () => {
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [{ query: "A", reason: "fits" }],
          reason: "ok"
        })
      },
      tts: { synthesize: async () => "/.cache/tts/a.mp3" },
      music: {
        resolve: async () => ({
          title: "A",
          artist: "B",
          url: "https://x/a.mp3",
          source: "netease"
        })
      }
    });

    const chat = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { prompt: "focus" }
    });
    const songId = chat.json().queue[1].id;
    await app.inject({ method: "POST", url: "/api/play", payload: { itemId: songId } });

    const response = await app.inject({ method: "GET", url: "/api/previous" });

    expect(response.statusCode).toBe(200);
    expect(response.json().currentIndex).toBe(0);

    await app.close();
  });

  it("passes rejected previous recommendations as avoid data on follow-up", async () => {
    const resolveCalls: unknown[] = [];
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [{ query: "Hotel California Eagles", title: "Hotel California", artist: "Eagles", reason: "fits" }],
          reason: "ok"
        })
      },
      tts: { synthesize: async () => "/.cache/tts/a.mp3" },
      music: {
        resolve: async (request) => {
          resolveCalls.push(request);
          return {
            title: "42",
            artist: "迪诺哥",
            url: "https://x/wrong.mp3",
            source: "netease"
          };
        }
      }
    });

    await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { prompt: "classic rock" }
    });
    await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { prompt: "你推荐的歌不是经典摇滚，重新推一些" }
    });

    expect(resolveCalls[1]).toMatchObject({
      avoid: [{ title: "42", artist: "迪诺哥" }]
    });

    await app.close();
  });

  it("starts an FM program with interleaved playback and FM messages", async () => {
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [],
          reason: "unused"
        }),
        planFm: async () => ({
          title: "Late Night Claudio",
          reason: "matches the evening",
          segments: [
            {
              intro: "This is Claudio. Here is a soft classic.",
              track: {
                query: "If Bread",
                title: "If",
                artist: "Bread",
                reason: "gentle late night song"
              }
            }
          ]
        })
      },
      tts: { synthesize: async (text) => `/.cache/tts/${encodeURIComponent(text)}.mp3` },
      music: {
        resolve: async (request) => ({
          title: request.title ?? request.query,
          artist: request.artist,
          url: `https://x/${request.query}.mp3`,
          source: "netease"
        })
      }
    });

    const response = await app.inject({ method: "POST", url: "/api/fm/start" });

    expect(response.statusCode).toBe(200);
    expect(response.json().state).toMatchObject({
      playbackMode: "fm",
      activeView: "fm",
      currentIndex: 0,
      status: "playing",
      fmProgram: {
        title: "Late Night Claudio",
        messages: [
          { type: "segue", text: "This is Claudio. Here is a soft classic." },
          { type: "nowPlaying", title: "If", artist: "Bread" }
        ]
      }
    });
    expect(response.json().state.queue.map((item: { kind: string }) => item.kind)).toEqual(["voice", "song"]);

    await app.close();
  });

  it("starts FM after resolving only the first song URL", async () => {
    const resolvedQueries: string[] = [];
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [],
          reason: "unused"
        }),
        planFm: async () => ({
          title: "Late Night Claudio",
          reason: "matches the evening",
          segments: [1, 2, 3, 4].map((number) => ({
            intro: `Segue ${number}`,
            track: {
              query: `Song ${number} Artist`,
              title: `Song ${number}`,
              artist: "Artist",
              reason: "fits"
            }
          }))
        })
      },
      tts: { synthesize: async (text) => `/.cache/tts/${text}.mp3` },
      music: {
        resolve: async (request) => {
          resolvedQueries.push(request.query);
          return {
            title: request.title ?? request.query,
            artist: request.artist,
            url: `https://x/${request.query}.mp3`,
            source: "netease"
          };
        }
      }
    });

    const response = await app.inject({ method: "POST", url: "/api/fm/start" });
    const songs = response.json().state.queue.filter((item: { kind: string }) => item.kind === "song");

    expect(response.statusCode).toBe(200);
    expect(resolvedQueries).toEqual(["Song 1 Artist"]);
    expect(songs.map((song: { url?: string }) => Boolean(song.url))).toEqual([true, false, false, false]);

    await app.close();
  });

  it("returns FM start before background continuation resolves", async () => {
    const continuation = deferred<{
      title: string;
      reason: string;
      segments: Array<{
        intro: string;
        track: { query: string; title: string; artist: string; reason: string };
      }>;
    }>();
    let continuationCalls = 0;
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [],
          reason: "unused"
        }),
        planFm: async () => ({
          title: "Late Night AirFM",
          reason: "matches the evening",
          segments: [
            {
              intro: "Opening segue",
              track: {
                query: "Song 1 Artist",
                title: "Song 1",
                artist: "Artist",
                reason: "fits"
              }
            }
          ]
        }),
        planFmContinuation: async () => {
          continuationCalls += 1;
          return continuation.promise;
        }
      },
      tts: { synthesize: async (text) => `/.cache/tts/${text}.mp3` },
      music: {
        resolve: async (request) => ({
          title: request.title ?? request.query,
          artist: request.artist,
          url: `https://x/${request.query}.mp3`,
          source: "netease"
        })
      }
    });

    const response = await app.inject({ method: "POST", url: "/api/fm/start" });

    expect(response.statusCode).toBe(200);
    expect(continuationCalls).toBe(1);
    expect(response.json().state.queue.map((item: { title: string }) => item.title)).toEqual([
      "FM Segue 1",
      "Song 1"
    ]);

    continuation.resolve({ title: "Late Night AirFM", reason: "more", segments: [] });
    await vi.waitFor(async () => {
      const now = await app.inject({ method: "GET", url: "/api/now" });
      expect(now.json().queue).toHaveLength(2);
    });
    await app.close();
  });

  it("appends FM continuation segments to the active program", async () => {
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [],
          reason: "unused"
        }),
        planFm: async () => ({
          title: "Late Night AirFM",
          reason: "matches the evening",
          segments: [
            {
              intro: "Opening segue",
              track: {
                query: "Song 1 Artist",
                title: "Song 1",
                artist: "Artist",
                reason: "fits"
              }
            }
          ]
        }),
        planFmContinuation: async () => ({
          title: "Late Night AirFM",
          reason: "continues the arc",
          segments: [
            {
              intro: "After Song 1, keep drifting into Song 2.",
              track: {
                query: "Song 2 Artist",
                title: "Song 2",
                artist: "Artist",
                reason: "keeps the flow"
              }
            },
            {
              intro: "Song 2 opens the door for Song 3.",
              track: {
                query: "Song 3 Artist",
                title: "Song 3",
                artist: "Artist",
                reason: "continues the flow"
              }
            }
          ]
        })
      },
      tts: { synthesize: async (text) => `/.cache/tts/${text}.mp3` },
      music: {
        resolve: async (request) => ({
          title: request.title ?? request.query,
          artist: request.artist,
          url: `https://x/${request.query}.mp3`,
          source: "netease"
        })
      }
    });

    const response = await app.inject({ method: "POST", url: "/api/fm/start" });
    const programId = response.json().state.fmProgram.id;

    await vi.waitFor(async () => {
      const now = await app.inject({ method: "GET", url: "/api/now" });
      expect(now.json().queue.map((item: { title: string }) => item.title)).toEqual([
        "FM Segue 1",
        "Song 1",
        "FM Segue 2",
        "Song 2",
        "FM Segue 3",
        "Song 3"
      ]);
    });

    const now = await app.inject({ method: "GET", url: "/api/now" });
    expect(now.json().queue.every((item: { programId: string }) => item.programId === programId)).toBe(true);
    expect(now.json().queue[2]).toMatchObject({ kind: "voice", url: "/.cache/tts/After Song 1, keep drifting into Song 2..mp3" });
    expect(now.json().queue[3]).toMatchObject({ kind: "song", playbackStatus: "ready" });
    expect(now.json().fmProgram.messages).toHaveLength(6);
    expect(now.json().fmProgram.messages.at(-1)).toMatchObject({
      type: "nowPlaying",
      title: "Song 3",
      segmentIndex: 2
    });

    await app.close();
  });

  it("does not interrupt active FM playback when continuation planning fails", async () => {
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [],
          reason: "unused"
        }),
        planFm: async () => ({
          title: "Late Night AirFM",
          reason: "matches the evening",
          segments: [
            {
              intro: "Opening segue",
              track: {
                query: "Song 1 Artist",
                title: "Song 1",
                artist: "Artist",
                reason: "fits"
              }
            }
          ]
        }),
        planFmContinuation: async () => {
          throw new Error("Claude output was not valid FM JSON");
        }
      },
      tts: { synthesize: async (text) => `/.cache/tts/${text}.mp3` },
      music: {
        resolve: async (request) => ({
          title: request.title ?? request.query,
          artist: request.artist,
          url: `https://x/${request.query}.mp3`,
          source: "netease"
        })
      }
    });

    const response = await app.inject({ method: "POST", url: "/api/fm/start" });

    await vi.waitFor(async () => {
      const now = await app.inject({ method: "GET", url: "/api/now" });
      expect(now.json().status).toBe("playing");
    });

    const now = await app.inject({ method: "GET", url: "/api/now" });
    expect(response.statusCode).toBe(200);
    expect(now.json()).toMatchObject({
      status: "playing",
      playbackMode: "fm",
      currentIndex: 0
    });
    expect(now.json().queue).toHaveLength(2);

    await app.close();
  });

  it("starts FM from the first later playable segment when the first two songs are unavailable", async () => {
    const resolvedQueries: string[] = [];
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [],
          reason: "unused"
        }),
        planFm: async () => ({
          title: "Late Morning AirFM",
          reason: "matches the morning",
          segments: [1, 2, 3].map((number) => ({
            intro: `Segue ${number}`,
            track: {
              query: `Song ${number} Artist`,
              title: `Song ${number}`,
              artist: "Artist",
              reason: "fits"
            }
          }))
        })
      },
      tts: { synthesize: async (text) => `/.cache/tts/${text}.mp3` },
      music: {
        resolve: async (request) => {
          resolvedQueries.push(request.query);
          if (request.query === "Song 1 Artist" || request.query === "Song 2 Artist") {
            return undefined;
          }

          return {
            title: request.title ?? request.query,
            artist: request.artist,
            url: `https://x/${request.query}.mp3`,
            source: "netease"
          };
        }
      }
    });

    const response = await app.inject({ method: "POST", url: "/api/fm/start" });

    expect(response.statusCode).toBe(200);
    expect(response.json().state).toMatchObject({
      playbackMode: "fm",
      currentIndex: 4,
      status: "playing"
    });
    expect(response.json().state.queue[4]).toMatchObject({
      kind: "voice",
      title: "FM Segue 3",
      url: "/.cache/tts/Segue 3.mp3"
    });
    expect(response.json().state.queue[5]).toMatchObject({
      kind: "song",
      title: "Song 3",
      playbackStatus: "ready"
    });
    expect(resolvedQueries).toEqual(["Song 1 Artist", "Song 2 Artist", "Song 3 Artist"]);

    await app.close();
  });

  it("does not synthesize every FM segue before the program starts", async () => {
    const synthesized: string[] = [];
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [],
          reason: "unused"
        }),
        planFm: async () => ({
          title: "Late Morning AirFM",
          reason: "matches the morning",
          segments: [1, 2, 3, 4].map((number) => ({
            intro: `Segue ${number}`,
            track: {
              query: `Song ${number} Artist`,
              title: `Song ${number}`,
              artist: "Artist",
              reason: "fits"
            }
          }))
        })
      },
      tts: {
        synthesize: async (text) => {
          synthesized.push(text);
          return `/.cache/tts/${text}.mp3`;
        }
      },
      music: {
        resolve: async (request) => ({
          title: request.title ?? request.query,
          artist: request.artist,
          url: `https://x/${request.query}.mp3`,
          source: "netease"
        })
      }
    });

    const response = await app.inject({ method: "POST", url: "/api/fm/start" });

    expect(response.statusCode).toBe(200);
    expect(synthesized).toEqual(["Segue 1"]);

    await app.close();
  });

  it("keeps the FM program active when chat generates recommendations during FM playback", async () => {
    let chatPlanCalls = 0;
    const app = await createApp({
      agent: {
        plan: async () => {
          chatPlanCalls += 1;
          return {
            say: "Here are some chat picks.",
            play: [{ query: "Chat Song Artist", title: "Chat Song", artist: "Artist", reason: "fits" }],
            reason: "chat"
          };
        },
        planFm: async () => ({
          title: "Late Night Claudio",
          reason: "matches the evening",
          segments: [
            {
              intro: "FM segue",
              track: {
                query: "FM Song Artist",
                title: "FM Song",
                artist: "Artist",
                reason: "fits"
              }
            }
          ]
        })
      },
      tts: { synthesize: async (text) => `/.cache/tts/${text}.mp3` },
      music: {
        resolve: async (request) => ({
          title: request.title ?? request.query,
          artist: request.artist,
          url: `https://x/${request.query}.mp3`,
          source: "netease"
        })
      }
    });

    const fm = await app.inject({ method: "POST", url: "/api/fm/start" });
    const fmQueue = fm.json().state.queue;

    const chat = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { prompt: "推荐一首歌" }
    });

    expect(chat.statusCode).toBe(200);
    expect(chatPlanCalls).toBe(1);
    expect(chat.json().state.playbackMode).toBe("fm");
    expect(chat.json().state.status).toBe("playing");
    expect(chat.json().state.queue).toEqual(fmQueue);
    expect(chat.json().state.messages.at(-1).recommendations).toEqual([
      expect.objectContaining({ title: "Chat Song", artist: "Artist" })
    ]);

    await app.close();
  });

  it("keeps FM playback state when chat planning fails during FM playback", async () => {
    const app = await createApp({
      agent: {
        plan: async () => {
          throw new Error("Chat planning failed");
        },
        planFm: async () => ({
          title: "Late Morning AirFM",
          reason: "matches the morning",
          segments: [
            {
              intro: "FM segue",
              track: {
                query: "FM Song Artist",
                title: "FM Song",
                artist: "Artist",
                reason: "fits"
              }
            }
          ]
        })
      },
      tts: { synthesize: async (text) => `/.cache/tts/${text}.mp3` },
      music: {
        resolve: async (request) => ({
          title: request.title ?? request.query,
          artist: request.artist,
          url: `https://x/${request.query}.mp3`,
          source: "netease"
        })
      }
    });

    const fm = await app.inject({ method: "POST", url: "/api/fm/start" });
    const fmState = fm.json().state;
    const chat = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { prompt: "推荐几首歌" }
    });

    expect(chat.statusCode).toBe(500);
    expect(chat.json().state).toMatchObject({
      playbackMode: "fm",
      status: "playing",
      currentIndex: fmState.currentIndex
    });
    expect(chat.json().state.queue).toEqual(fmState.queue);

    await app.close();
  });

  it("resolves a song without changing playback state", async () => {
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [],
          reason: "unused"
        }),
        planFm: async () => ({
          title: "Late Night Claudio",
          reason: "matches the evening",
          segments: [
            {
              intro: "FM segue",
              track: {
                query: "FM Song Artist",
                title: "FM Song",
                artist: "Artist",
                reason: "fits"
              }
            }
          ]
        })
      },
      tts: { synthesize: async (text) => `/.cache/tts/${text}.mp3` },
      music: {
        resolve: async (request) => ({
          title: request.title ?? request.query,
          artist: request.artist,
          url: `https://x/${request.query}.mp3`,
          source: "netease"
        })
      }
    });

    const fm = await app.inject({ method: "POST", url: "/api/fm/start" });
    const resolved = await app.inject({
      method: "POST",
      url: "/api/resolve-song",
      payload: {
        query: "Chat Song Artist",
        title: "Chat Song",
        artist: "Artist",
        reason: "refresh stale chat URL"
      }
    });
    const now = await app.inject({ method: "GET", url: "/api/now" });

    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({
      kind: "song",
      title: "Chat Song",
      artist: "Artist",
      url: "https://x/Chat Song Artist.mp3",
      playbackStatus: "ready"
    });
    expect(now.json().queue).toEqual(fm.json().state.queue);
    expect(now.json().playbackMode).toBe("fm");

    await app.close();
  });

  it("prefetches later FM songs while advancing through the program", async () => {
    const resolvedQueries: string[] = [];
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [],
          reason: "unused"
        }),
        planFm: async () => ({
          title: "Late Night Claudio",
          reason: "matches the evening",
          segments: [1, 2, 3, 4].map((number) => ({
            intro: `Segue ${number}`,
            track: {
              query: `Song ${number} Artist`,
              title: `Song ${number}`,
              artist: "Artist",
              reason: "fits"
            }
          }))
        })
      },
      tts: { synthesize: async (text) => `/.cache/tts/${text}.mp3` },
      music: {
        resolve: async (request) => {
          resolvedQueries.push(request.query);
          return {
            title: request.title ?? request.query,
            artist: request.artist,
            url: `https://x/${request.query}.mp3`,
            source: "netease"
          };
        }
      }
    });

    const fm = await app.inject({ method: "POST", url: "/api/fm/start" });
    const firstVoiceId = fm.json().state.queue[0].id;

    const next = await app.inject({ method: "GET", url: `/api/next?itemId=${firstVoiceId}` });
    const songs = next.json().queue.filter((item: { kind: string }) => item.kind === "song");

    expect(next.statusCode).toBe(200);
    expect(resolvedQueries).toEqual([
      "Song 1 Artist",
      "Song 2 Artist",
      "Song 3 Artist",
      "Song 4 Artist"
    ]);
    expect(songs.map((song: { url?: string }) => Boolean(song.url))).toEqual([true, true, true, true]);

    await app.close();
  });

  it("prefetches later FM segue voices while the current song is playing", async () => {
    const synthesized: string[] = [];
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [],
          reason: "unused"
        }),
        planFm: async () => ({
          title: "Late Night AirFM",
          reason: "matches the evening",
          segments: [1, 2, 3, 4].map((number) => ({
            intro: `Segue ${number}`,
            track: {
              query: `Song ${number} Artist`,
              title: `Song ${number}`,
              artist: "Artist",
              reason: "fits"
            }
          }))
        })
      },
      tts: {
        synthesize: async (text) => {
          synthesized.push(text);
          return `/.cache/tts/${text}.mp3`;
        }
      },
      music: {
        resolve: async (request) => ({
          title: request.title ?? request.query,
          artist: request.artist,
          url: `https://x/${request.query}.mp3`,
          source: "netease"
        })
      }
    });

    const fm = await app.inject({ method: "POST", url: "/api/fm/start" });
    const firstVoiceId = fm.json().state.queue[0].id;

    const next = await app.inject({ method: "GET", url: `/api/next?itemId=${firstVoiceId}` });
    const voices = next.json().queue.filter((item: { kind: string }) => item.kind === "voice");

    expect(next.statusCode).toBe(200);
    expect(synthesized).toEqual(["Segue 1", "Segue 2", "Segue 3", "Segue 4"]);
    expect(voices.map((voice: { url?: string }) => Boolean(voice.url))).toEqual([true, true, true, true]);

    await app.close();
  });

  it("updates FM now playing messages when pending songs resolve during prefetch", async () => {
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [],
          reason: "unused"
        }),
        planFm: async () => ({
          title: "Late Night Claudio",
          reason: "matches the evening",
          segments: [1, 2, 3].map((number) => ({
            intro: `Segue ${number}`,
            track: {
              query: `Planned Song ${number} Artist`,
              title: `Planned Song ${number}`,
              artist: "Artist",
              reason: "fits"
            }
          }))
        })
      },
      tts: { synthesize: async (text) => `/.cache/tts/${text}.mp3` },
      music: {
        resolve: async (request) => ({
          title: request.query === "Planned Song 3 Artist" ? "Resolved Song 3" : request.title ?? request.query,
          artist: request.artist,
          url: `https://x/${request.query}.mp3`,
          source: "netease"
        })
      }
    });

    const fm = await app.inject({ method: "POST", url: "/api/fm/start" });
    const firstVoiceId = fm.json().state.queue[0].id;
    const next = await app.inject({ method: "GET", url: `/api/next?itemId=${firstVoiceId}` });
    const resolvedSong = next.json().queue.find((item: { title: string }) => item.title === "Resolved Song 3");
    const nowPlaying = next
      .json()
      .fmProgram.messages.find((message: { songItemId?: string }) => message.songItemId === resolvedSong.id);

    expect(resolvedSong).toMatchObject({
      title: "Resolved Song 3",
      artist: "Artist",
      playbackStatus: "ready"
    });
    expect(nowPlaying).toMatchObject({
      title: "Resolved Song 3",
      artist: "Artist"
    });

    await app.close();
  });

  it("skips an FM segue when its paired song cannot be resolved", async () => {
    const resolvedQueries: string[] = [];
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [],
          reason: "unused"
        }),
        planFm: async () => ({
          title: "Late Night Claudio",
          reason: "matches the evening",
          segments: [1, 2, 3].map((number) => ({
            intro: `Segue ${number}`,
            track: {
              query: `Song ${number} Artist`,
              title: `Song ${number}`,
              artist: "Artist",
              reason: "fits"
            }
          }))
        })
      },
      tts: { synthesize: async (text) => `/.cache/tts/${text}.mp3` },
      music: {
        resolve: async (request) => {
          resolvedQueries.push(request.query);
          if (request.query === "Song 2 Artist") {
            return undefined;
          }

          return {
            title: request.title ?? request.query,
            artist: request.artist,
            url: `https://x/${request.query}.mp3`,
            source: "netease"
          };
        }
      }
    });

    const fm = await app.inject({ method: "POST", url: "/api/fm/start" });
    const firstVoiceId = fm.json().state.queue[0].id;
    const firstSongId = fm.json().state.queue[1].id;

    await app.inject({ method: "GET", url: `/api/next?itemId=${firstVoiceId}` });
    const next = await app.inject({ method: "GET", url: `/api/next?itemId=${firstSongId}` });

    expect(next.statusCode).toBe(200);
    expect(next.json().queue[3]).toMatchObject({
      title: "Song 2",
      playbackStatus: "unavailable"
    });
    expect(next.json().currentIndex).toBe(4);
    expect(next.json().queue[4]).toMatchObject({
      kind: "voice",
      title: "FM Segue 3"
    });
    expect(resolvedQueries).toContain("Song 3 Artist");

    await app.close();
  });

  it("does not refresh ready FM song URLs during normal advance", async () => {
    let resolveCalls = 0;
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [],
          reason: "unused"
        }),
        planFm: async () => ({
          title: "Late Night Claudio",
          reason: "matches the evening",
          segments: [
            {
              intro: "This is Claudio. Here is a soft classic.",
              track: {
                query: "If Bread",
                title: "If",
                artist: "Bread",
                reason: "gentle late night song"
              }
            }
          ]
        })
      },
      tts: { synthesize: async () => "/.cache/tts/segue.mp3" },
      music: {
        resolve: async (request) => {
          resolveCalls += 1;
          return {
            title: request.title ?? request.query,
            artist: request.artist,
            url: `https://x/${request.query}-${resolveCalls}.mp3`,
            source: "netease"
          };
        }
      }
    });

    const fm = await app.inject({ method: "POST", url: "/api/fm/start" });
    const firstVoiceId = fm.json().state.queue[0].id;

    const next = await app.inject({ method: "GET", url: `/api/next?itemId=${firstVoiceId}` });

    expect(next.statusCode).toBe(200);
    expect(next.json().currentIndex).toBe(1);
    expect(resolveCalls).toBe(1);
    expect(next.json().queue[1]).toMatchObject({
      title: "If",
      artist: "Bread",
      query: "If Bread",
      url: "https://x/If Bread-1.mp3"
    });

    await app.close();
  });

  it("force refreshes FM song URLs when playback reports a stale URL", async () => {
    let resolveCalls = 0;
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [],
          reason: "unused"
        }),
        planFm: async () => ({
          title: "Late Night Claudio",
          reason: "matches the evening",
          segments: [
            {
              intro: "This is Claudio. Here is a soft classic.",
              track: {
                query: "If Bread",
                title: "If",
                artist: "Bread",
                reason: "gentle late night song"
              }
            }
          ]
        })
      },
      tts: { synthesize: async () => "/.cache/tts/segue.mp3" },
      music: {
        resolve: async (request) => {
          resolveCalls += 1;
          return {
            title: request.title ?? request.query,
            artist: request.artist,
            url: `https://x/${request.query}-${resolveCalls}.mp3`,
            source: "netease"
          };
        }
      }
    });

    const fm = await app.inject({ method: "POST", url: "/api/fm/start" });
    const songId = fm.json().state.queue[1].id;

    const play = await app.inject({ method: "POST", url: "/api/play", payload: { itemId: songId, refresh: true } });

    expect(play.statusCode).toBe(200);
    expect(resolveCalls).toBe(2);
    expect(play.json().queue[1].url).toBe("https://x/If Bread-2.mp3");

    await app.close();
  });

  it("exposes Netease QR login endpoints", async () => {
    const savedCookies: string[] = [];
    const app = await createApp({
      agent: {
        plan: async () => ({
          say: "Intro",
          play: [],
          reason: "ok"
        })
      },
      tts: { synthesize: async () => "/.cache/tts/a.mp3" },
      music: { resolve: async () => undefined },
      netease: {
        createLoginQr: async () => ({
          key: "qr-key",
          qrImage: "data:image/png;base64,abc",
          qrUrl: "orpheus://qr"
        }),
        checkLogin: async () => ({ code: 803, message: "authorized", loggedIn: true }),
        status: async () => ({ loggedIn: true }),
        importCookie: async (cookie) => {
          savedCookies.push(cookie);
          return { loggedIn: true };
        },
        logout: async () => undefined
      }
    });

    const qr = await app.inject({ method: "POST", url: "/api/netease/login/qr" });
    expect(qr.statusCode).toBe(200);
    expect(qr.json()).toMatchObject({ key: "qr-key", qrImage: "data:image/png;base64,abc" });

    const check = await app.inject({ method: "GET", url: "/api/netease/login/check?key=qr-key" });
    expect(check.statusCode).toBe(200);
    expect(check.json()).toMatchObject({ code: 803, loggedIn: true });

    const status = await app.inject({ method: "GET", url: "/api/netease/login/status" });
    expect(status.json()).toEqual({ loggedIn: true });

    const imported = await app.inject({
      method: "POST",
      url: "/api/netease/session",
      payload: { cookie: "MUSIC_U=abc; __csrf=def" }
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toEqual({ loggedIn: true });
    expect(savedCookies).toEqual(["MUSIC_U=abc; __csrf=def"]);

    const logout = await app.inject({ method: "POST", url: "/api/netease/logout" });
    expect(logout.statusCode).toBe(200);

    await app.close();
  });
});
