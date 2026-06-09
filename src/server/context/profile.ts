import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface UserProfile {
  taste: string;
  routines: string;
  playlists: string;
  moodRules: string;
}

export async function readTextFile(path: string, fallback: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return fallback;
  }
}

export async function writeTextFile(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}

export async function loadUserProfile(): Promise<UserProfile> {
  const [taste, routines, playlists, moodRules] = await Promise.all([
    readTextFile("user/taste.md", ""),
    readTextFile("user/routines.md", ""),
    readTextFile("user/playlists.json", "{}"),
    readTextFile("user/mood-rules.md", "")
  ]);
  return { taste, routines, playlists, moodRules };
}
