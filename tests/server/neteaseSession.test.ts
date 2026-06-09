import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearNeteaseSession,
  getNeteaseCookie,
  getNeteaseSessionStatus,
  saveNeteaseSession,
  validateNeteaseCookie
} from "../../src/server/music/neteaseSession";

describe("Netease session", () => {
  let dir = "";
  let sessionPath = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "radio-netease-session-"));
    sessionPath = join(dir, "netease-session.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists the login cookie and reports logged in status", async () => {
    await saveNeteaseSession(sessionPath, "MUSIC_U=abc; __csrf=def");

    await expect(getNeteaseCookie(sessionPath)).resolves.toBe("MUSIC_U=abc; __csrf=def");
    await expect(getNeteaseSessionStatus(sessionPath)).resolves.toMatchObject({
      loggedIn: true
    });
  });

  it("falls back to env cookie when no session file exists", async () => {
    await expect(getNeteaseCookie(sessionPath, "MUSIC_U=env")).resolves.toBe("MUSIC_U=env");
  });

  it("clears the saved login cookie", async () => {
    await saveNeteaseSession(sessionPath, "MUSIC_U=abc");
    await clearNeteaseSession(sessionPath);

    await expect(getNeteaseSessionStatus(sessionPath)).resolves.toEqual({ loggedIn: false });
  });

  it("rejects cookies without a Netease login token", () => {
    expect(() => validateNeteaseCookie("__csrf=def")).toThrow("Netease cookie must include MUSIC_U");
  });
});
