import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNeteaseAuthService } from "../../src/server/music/neteaseAuth";
import { getNeteaseCookie } from "../../src/server/music/neteaseSession";

describe("Netease auth service", () => {
  let dir = "";
  let sessionPath = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "radio-netease-auth-"));
    sessionPath = join(dir, "netease-session.json");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a QR login challenge from NeteaseCloudMusicApi", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo) => {
        const url = String(input);
        if (url.includes("/login/qr/key")) {
          return new Response(JSON.stringify({ code: 200, data: { unikey: "qr-key" } }), { status: 200 });
        }
        if (url.includes("/login/qr/create")) {
          expect(url).toContain("key=qr-key");
          expect(url).toContain("qrimg=true");
          return new Response(
            JSON.stringify({ code: 200, data: { qrimg: "data:image/png;base64,abc", qrurl: "orpheus://qr" } }),
            { status: 200 }
          );
        }
        throw new Error(`Unexpected URL ${url}`);
      })
    );

    const auth = createNeteaseAuthService("http://netease.test", sessionPath);

    await expect(auth.createLoginQr()).resolves.toEqual({
      key: "qr-key",
      qrImage: "data:image/png;base64,abc",
      qrUrl: "orpheus://qr"
    });
  });

  it("saves the cookie when QR check returns success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ code: 803, message: "authorized", cookie: "MUSIC_U=abc; __csrf=def" }), {
          status: 200
        })
      )
    );
    const auth = createNeteaseAuthService("http://netease.test", sessionPath);

    await expect(auth.checkLogin("qr-key")).resolves.toMatchObject({
      code: 803,
      loggedIn: true
    });
    await expect(getNeteaseCookie(sessionPath)).resolves.toBe("MUSIC_U=abc; __csrf=def");
  });
});
