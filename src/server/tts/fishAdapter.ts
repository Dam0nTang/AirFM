import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ProxyAgent } from "undici";

type FishRequestInit = RequestInit & {
  dispatcher?: ProxyAgent;
};

export function ttsCachePath(text: string): string {
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 24);
  return `.cache/tts/${hash}.mp3`;
}

export function createFishTtsRequest(
  apiKey: string,
  voiceId: string,
  text: string,
  proxy?: string
) {
  const init: FishRequestInit = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      model: "s2-pro"
    },
    body: JSON.stringify({ text, reference_id: voiceId, format: "mp3" })
  };

  if (proxy) {
    init.dispatcher = new ProxyAgent(proxy);
  }

  return {
    url: "https://api.fish.audio/v1/tts",
    init
  };
}

export async function synthesizeFishSpeech(
  apiKey: string,
  voiceId: string,
  text: string,
  proxy?: string
): Promise<string> {
  const path = ttsCachePath(text);
  try {
    await readFile(path);
    return `/${path}`;
  } catch {
    await mkdir(".cache/tts", { recursive: true });
  }

  if (!apiKey || !voiceId) {
    throw new Error("Fish Audio API key and voice id are required for TTS");
  }

  const request = createFishTtsRequest(apiKey, voiceId, text, proxy);
  const response = await fetch(request.url, {
    ...request.init,
    signal: AbortSignal.timeout(15_000)
  } as RequestInit);

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Fish Audio TTS failed: ${response.status}${detail ? ` ${detail}` : ""}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(path, buffer);
  return `/${path}`;
}
