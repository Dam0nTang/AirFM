import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveNeteaseSong } from "../../src/server/music/neteaseAdapter";

describe("Netease adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("selects a later candidate when it matches requested title and artist", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.includes("/cloudsearch")) {
        return new Response(
          JSON.stringify({
            result: {
              songs: [
                { id: 1, name: "42", artists: [{ name: "迪诺哥" }] },
                { id: 2, name: "Hotel California", artists: [{ name: "Eagles" }] }
              ]
            }
          }),
          { status: 200 }
        );
      }

      expect(url).toContain("/song/url/v1");
      expect(url).toContain("id=2");
      return new Response(JSON.stringify({ data: [{ url: "https://music.example/hotel.mp3" }] }), {
        status: 200
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const song = await resolveNeteaseSong("http://netease.test", {
      query: "Hotel California Eagles",
      title: "Hotel California",
      artist: "Eagles",
      reason: "classic rock"
    });

    expect(song?.title).toBe("Hotel California");
    expect(song?.artist).toBe("Eagles");
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/search"));
  });

  it("rejects obvious DJ versions when a better original candidate exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo) => {
        const url = String(input);
        if (url.includes("/cloudsearch")) {
          return new Response(
            JSON.stringify({
              result: {
                songs: [
                  { id: 1, name: "Hotel California DJ版", artists: [{ name: "Some DJ" }] },
                  { id: 2, name: "Hotel California", artists: [{ name: "Eagles" }] }
                ]
              }
            }),
            { status: 200 }
          );
        }

        expect(url).toContain("/song/url/v1");
        expect(url).toContain("id=2");
        return new Response(JSON.stringify({ data: [{ url: "https://music.example/hotel.mp3" }] }), {
          status: 200
        });
      })
    );

    const song = await resolveNeteaseSong("http://netease.test", {
      query: "Hotel California Eagles",
      title: "Hotel California",
      artist: "Eagles",
      reason: "classic rock"
    });

    expect(song?.title).toBe("Hotel California");
  });

  it("falls back to normal search when cloud search has no usable candidates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo) => {
        const url = String(input);
        if (url.includes("/cloudsearch")) {
          return new Response(JSON.stringify({ result: { songs: [] } }), { status: 200 });
        }

        if (url.includes("/search")) {
          return new Response(
            JSON.stringify({
              result: {
                songs: [{ id: 2, name: "Bohemian Rhapsody", artists: [{ name: "Queen" }] }]
              }
            }),
            { status: 200 }
          );
        }

        expect(url).toContain("/song/url/v1");
        expect(url).toContain("id=2");
        return new Response(JSON.stringify({ data: [{ url: "https://music.example/queen.mp3" }] }), {
          status: 200
        });
      })
    );

    const song = await resolveNeteaseSong("http://netease.test", {
      query: "Queen Bohemian Rhapsody",
      title: "Bohemian Rhapsody",
      artist: "Queen"
    });

    expect(song?.title).toBe("Bohemian Rhapsody");
  });

  it("tries the next ranked candidate when the first one has no playable url", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo) => {
        const url = String(input);
        if (url.includes("/cloudsearch")) {
          return new Response(
            JSON.stringify({
              result: {
                songs: [
                  { id: 1, name: "Wish You Were Here", ar: [{ name: "Pink Floyd" }] },
                  { id: 2, name: "Wish You Were Here", ar: [{ name: "Pink Floyd" }] }
                ]
              }
            }),
            { status: 200 }
          );
        }

        if (url.includes("/song/url/v1") && url.includes("id=1")) {
          return new Response(JSON.stringify({ data: [{ url: null }] }), { status: 200 });
        }

        if (url.includes("/song/url") && !url.includes("/song/url/v1") && url.includes("id=1")) {
          return new Response(JSON.stringify({ data: [{ url: null }] }), { status: 200 });
        }

        expect(url).toContain("/song/url/v1");
        expect(url).toContain("id=2");
        return new Response(JSON.stringify({ data: [{ url: "https://music.example/pink-floyd.mp3" }] }), {
          status: 200
        });
      })
    );

    const song = await resolveNeteaseSong("http://netease.test", {
      query: "Pink Floyd Wish You Were Here",
      title: "Wish You Were Here",
      artist: "Pink Floyd"
    });

    expect(song?.url).toBe("https://music.example/pink-floyd.mp3");
  });

  it("rejects candidates with a matching title but mismatched requested artist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo) => {
        const url = String(input);
        if (url.includes("/cloudsearch") || url.includes("/search")) {
          return new Response(
            JSON.stringify({
              result: {
                songs: [{ id: 1, name: "需要人陪", artists: [{ name: "王力宏" }] }]
              }
            }),
            { status: 200 }
          );
        }

        throw new Error("URL lookup should not run for mismatched artist candidates");
      })
    );

    const song = await resolveNeteaseSong("http://netease.test", {
      query: "需要人陪 方大同",
      title: "需要人陪",
      artist: "方大同"
    });

    expect(song).toBeUndefined();
  });

  it("rejects candidates with a matching artist but mismatched requested title", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.includes("/cloudsearch") || url.includes("/search")) {
        return new Response(
          JSON.stringify({
            result: {
              songs: [{ id: 1, name: "麦恩莉", artists: [{ name: "方大同" }] }]
            }
          }),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify({ data: [{ url: "https://music.example/wrong.mp3" }] }), {
        status: 200
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const song = await resolveNeteaseSong("http://netease.test", {
      query: "Color of Love 方大同",
      title: "Color of Love",
      artist: "方大同"
    });

    expect(song).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/song/url"));
  });

  it("falls back to the legacy url endpoint when url v1 is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo) => {
        const url = String(input);
        if (url.includes("/cloudsearch")) {
          return new Response(
            JSON.stringify({
              result: {
                songs: [{ id: 2, name: "Hotel California", ar: [{ name: "Eagles" }] }]
              }
            }),
            { status: 200 }
          );
        }

        if (url.includes("/song/url/v1")) {
          return new Response(JSON.stringify({ code: 502 }), { status: 502 });
        }

        expect(url).toContain("/song/url");
        expect(url).toContain("id=2");
        return new Response(JSON.stringify({ data: [{ url: "https://music.example/legacy.mp3" }] }), {
          status: 200
        });
      })
    );

    const song = await resolveNeteaseSong("http://netease.test", {
      query: "Eagles Hotel California",
      title: "Hotel California",
      artist: "Eagles"
    });

    expect(song?.url).toBe("https://music.example/legacy.mp3");
  });

  it("falls back to the legacy url endpoint when url v1 throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo) => {
        const url = String(input);
        if (url.includes("/cloudsearch")) {
          return new Response(
            JSON.stringify({
              result: {
                songs: [{ id: 2, name: "Hotel California", ar: [{ name: "Eagles" }] }]
              }
            }),
            { status: 200 }
          );
        }

        if (url.includes("/song/url/v1")) {
          throw new Error("Client network socket disconnected");
        }

        expect(url).toContain("/song/url");
        expect(url).toContain("id=2");
        return new Response(JSON.stringify({ data: [{ url: "https://music.example/legacy.mp3" }] }), {
          status: 200
        });
      })
    );

    const song = await resolveNeteaseSong("http://netease.test", {
      query: "Eagles Hotel California",
      title: "Hotel California",
      artist: "Eagles"
    });

    expect(song?.url).toBe("https://music.example/legacy.mp3");
  });

  it("passes the configured cookie to Netease API requests", async () => {
    const seenUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo) => {
        const url = String(input);
        seenUrls.push(url);
        if (url.includes("/cloudsearch")) {
          return new Response(
            JSON.stringify({
              result: {
                songs: [{ id: 2, name: "Hotel California", ar: [{ name: "Eagles" }] }]
              }
            }),
            { status: 200 }
          );
        }

        return new Response(JSON.stringify({ data: [{ url: "https://music.example/hotel.mp3" }] }), {
          status: 200
        });
      })
    );

    await resolveNeteaseSong(
      "http://netease.test",
      {
        query: "Eagles Hotel California",
        title: "Hotel California",
        artist: "Eagles"
      },
      { cookie: "MUSIC_U=abc; __csrf=def" }
    );

    expect(seenUrls.every((url) => url.includes("cookie=MUSIC_U%3Dabc%3B+__csrf%3Ddef"))).toBe(true);
  });
});
