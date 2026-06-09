import type { PlaybackState, QueueItem } from "../shared/types";

export async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; error?: string };
    const detail = body.message ?? body.error;
    return detail ? `${fallback}: ${detail}` : `${fallback}: ${response.status}`;
  } catch {
    return `${fallback}: ${response.status}`;
  }
}

export async function sendPrompt(prompt: string): Promise<{ state: PlaybackState }> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt })
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Chat failed"));
  }

  return response.json();
}

export async function nextTrack(itemId?: string): Promise<PlaybackState> {
  const url = itemId ? `/api/next?itemId=${encodeURIComponent(itemId)}` : "/api/next";
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Next track failed"));
  }

  return response.json();
}

export async function previousTrack(): Promise<PlaybackState> {
  const response = await fetch("/api/previous");

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Previous track failed"));
  }

  return response.json();
}

export async function playQueueItem(itemId: string, options: { refresh?: boolean } = {}): Promise<PlaybackState> {
  const response = await fetch("/api/play", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId, refresh: options.refresh })
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Play failed"));
  }

  return response.json();
}

export async function resolveSong(item: Pick<QueueItem, "query" | "title" | "artist" | "reason">): Promise<QueueItem> {
  const response = await fetch("/api/resolve-song", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: item.query ?? [item.title, item.artist].filter(Boolean).join(" "),
      title: item.title,
      artist: item.artist,
      reason: item.reason
    })
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Song refresh failed"));
  }

  return response.json();
}

export async function stopPlaybackSession(): Promise<PlaybackState> {
  const response = await fetch("/api/stop", { method: "POST" });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Stop failed"));
  }

  return response.json();
}

export async function startFmProgram(): Promise<{ state: PlaybackState }> {
  const response = await fetch("/api/fm/start", { method: "POST" });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "FM start failed"));
  }

  return response.json();
}

export function connectStream(onState: (state: PlaybackState) => void): WebSocket {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${location.host}/stream`);

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state") {
      onState(message.state);
    }
  });

  return socket;
}

export interface UserProfilePayload {
  taste: string;
  routines: string;
  playlists: string;
  moodRules: string;
}

export async function getTaste(): Promise<UserProfilePayload> {
  const response = await fetch("/api/taste");
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Profile load failed"));
  }
  return response.json();
}

export async function saveTaste(profile: UserProfilePayload): Promise<UserProfilePayload> {
  const response = await fetch("/api/taste", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile)
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Profile save failed"));
  }

  return response.json();
}

export interface NeteaseLoginStatus {
  loggedIn: boolean;
  updatedAt?: string;
}

export interface NeteaseQrChallenge {
  key: string;
  qrImage: string;
  qrUrl: string;
}

export interface NeteaseQrCheck {
  code: number;
  message?: string;
  loggedIn: boolean;
}

export async function getNeteaseLoginStatus(): Promise<NeteaseLoginStatus> {
  const response = await fetch("/api/netease/login/status");
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Netease status failed"));
  }
  return response.json();
}

export async function createNeteaseLoginQr(): Promise<NeteaseQrChallenge> {
  const response = await fetch("/api/netease/login/qr", { method: "POST" });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Netease QR failed"));
  }
  return response.json();
}

export async function checkNeteaseLogin(key: string): Promise<NeteaseQrCheck> {
  const response = await fetch(`/api/netease/login/check?key=${encodeURIComponent(key)}`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Netease login check failed"));
  }
  return response.json();
}

export async function logoutNetease(): Promise<NeteaseLoginStatus> {
  const response = await fetch("/api/netease/logout", { method: "POST" });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Netease logout failed"));
  }
  return response.json();
}

export async function importNeteaseCookie(cookie: string): Promise<NeteaseLoginStatus> {
  const response = await fetch("/api/netease/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookie })
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Netease cookie import failed"));
  }

  return response.json();
}
