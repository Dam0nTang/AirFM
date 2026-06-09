import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface NeteaseSessionStatus {
  loggedIn: boolean;
  updatedAt?: string;
}

interface StoredNeteaseSession {
  cookie: string;
  updatedAt: string;
}

export const DEFAULT_NETEASE_SESSION_PATH = "data/netease-session.json";

export async function saveNeteaseSession(path: string, cookie: string): Promise<void> {
  validateNeteaseCookie(cookie);
  await mkdir(dirname(path), { recursive: true });
  const session: StoredNeteaseSession = {
    cookie,
    updatedAt: new Date().toISOString()
  };
  await writeFile(path, JSON.stringify(session, null, 2), "utf8");
}

export function validateNeteaseCookie(cookie: string): void {
  if (!/(^|;\s*)MUSIC_U=/.test(cookie.trim())) {
    throw new Error("Netease cookie must include MUSIC_U");
  }
}

export async function getNeteaseCookie(path: string, fallback = ""): Promise<string> {
  try {
    const raw = await readFile(path, "utf8");
    const session = JSON.parse(raw) as Partial<StoredNeteaseSession>;
    return session.cookie || fallback;
  } catch {
    return fallback;
  }
}

export async function getNeteaseSessionStatus(path: string): Promise<NeteaseSessionStatus> {
  try {
    const raw = await readFile(path, "utf8");
    const session = JSON.parse(raw) as Partial<StoredNeteaseSession>;
    return session.cookie ? { loggedIn: true, updatedAt: session.updatedAt } : { loggedIn: false };
  } catch {
    return { loggedIn: false };
  }
}

export async function clearNeteaseSession(path: string): Promise<void> {
  await rm(path, { force: true });
}
