import cors from "@fastify/cors";
import staticFiles from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { mkdirSync } from "node:fs";
import { nanoid } from "nanoid";
import { resolve } from "node:path";
import type { ValidFmProgram } from "./agent/fmSchema";
import type { ChatIntent, SongInfoResponse } from "./agent/intentSchema";
import type { ValidAgentPlan } from "./agent/schema";
import type { NeteaseAuthService } from "./music/neteaseAuth";
import type { ResolvedSong, SongResolveRequest } from "./music/neteaseAdapter";
import { buildFmQueue, buildPlaybackQueue } from "./playback/queue";
import { createStreamHub } from "./realtime/stream";
import { loadUserProfile, writeTextFile } from "./context/profile";
import type { PlaybackState } from "../shared/types";

interface Services {
  agent: {
    classify?(
      prompt: string,
      messages: PlaybackState["messages"],
      queue: PlaybackState["queue"],
      currentIndex: number
    ): Promise<ChatIntent>;
    explain?(
      prompt: string,
      messages: PlaybackState["messages"],
      queue: PlaybackState["queue"],
      intent: ChatIntent,
      currentIndex: number
    ): Promise<SongInfoResponse>;
    plan(
      prompt: string,
      messages: PlaybackState["messages"],
      avoidTracks: Array<{ title?: string; artist?: string; query?: string }>
    ): Promise<ValidAgentPlan>;
    planFm?(
      messages: PlaybackState["messages"],
      avoidTracks: Array<{ title?: string; artist?: string; query?: string }>
    ): Promise<ValidFmProgram>;
    planFmContinuation?(
      fmProgram: FmProgramState,
      queue: PlaybackState["queue"],
      messages: PlaybackState["messages"],
      avoidTracks: Array<{ title?: string; artist?: string; query?: string }>
    ): Promise<ValidFmProgram>;
  };
  tts: { synthesize(text: string): Promise<string> };
  music: { resolve(request: SongResolveRequest): Promise<ResolvedSong | undefined> };
  netease?: NeteaseAuthService;
}

type FmProgramState = NonNullable<PlaybackState["fmProgram"]>;

function syncFmNowPlayingMessage(
  fmProgram: FmProgramState | undefined,
  item: PlaybackState["queue"][number] | undefined
): void {
  if (!fmProgram || !item || item.kind !== "song") {
    return;
  }

  fmProgram.messages = fmProgram.messages.map((message) =>
    message.type === "nowPlaying" && message.songItemId === item.id
      ? {
          ...message,
          title: item.title,
          artist: item.artist
        }
      : message
  );
}

function pairedFmSongIndex(queue: PlaybackState["queue"], segueIndex: number): number {
  const segue = queue[segueIndex];
  if (segue?.fmRole !== "segue") {
    return -1;
  }

  return queue.findIndex(
    (item) =>
      item.fmRole === "song" &&
      item.programId === segue.programId &&
      item.segmentIndex === segue.segmentIndex
  );
}

async function isPlayableCandidate(
  queue: PlaybackState["queue"],
  index: number,
  music: Services["music"],
  tts: Services["tts"],
  fmProgram?: FmProgramState
): Promise<boolean> {
  const item = queue[index];
  if (!item) {
    return false;
  }

  if (item.fmRole === "segue") {
    const songIndex = pairedFmSongIndex(queue, index);
    if (songIndex < 0) {
      return false;
    }

    await refreshVoiceUrl(queue, index, tts);
    await refreshSongUrl(queue, songIndex, music, { fmProgram });
    return Boolean(queue[index]?.url && queue[songIndex]?.url);
  }

  if (item.kind === "song") {
    await refreshSongUrl(queue, index, music, { fmProgram });
    return Boolean(queue[index]?.url);
  }

  return Boolean(item.url);
}

async function nextPlayableIndex(
  queue: PlaybackState["queue"],
  currentIndex: number,
  music: Services["music"],
  tts: Services["tts"],
  fmProgram?: FmProgramState
): Promise<number> {
  for (let index = currentIndex + 1; index < queue.length; index += 1) {
    if (await isPlayableCandidate(queue, index, music, tts, fmProgram)) {
      return index;
    }
  }

  return currentIndex;
}

async function previousPlayableIndex(
  queue: PlaybackState["queue"],
  currentIndex: number,
  music: Services["music"],
  tts: Services["tts"],
  fmProgram?: FmProgramState
): Promise<number> {
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    if (await isPlayableCandidate(queue, index, music, tts, fmProgram)) {
      return index;
    }
  }
  return currentIndex;
}

async function refreshVoiceUrl(
  queue: PlaybackState["queue"],
  index: number,
  tts: Services["tts"]
): Promise<void> {
  const item = queue[index];
  if (!item || item.kind !== "voice" || item.url || !item.text) {
    return;
  }

  try {
    queue[index] = {
      ...item,
      url: await tts.synthesize(item.text),
      reason: undefined
    };
  } catch {
    queue[index] = {
      ...item,
      reason: "TTS audio unavailable"
    };
  }
}

async function refreshSongUrl(
  queue: PlaybackState["queue"],
  index: number,
  music: Services["music"],
  options: { force?: boolean; fmProgram?: FmProgramState } = {}
): Promise<void> {
  const item = queue[index];
  if (!item || item.kind !== "song") {
    return;
  }

  if (item.url && item.playbackStatus === "ready" && !options.force) {
    return;
  }

  if (item.playbackStatus === "unavailable" && !options.force) {
    return;
  }

  try {
    const song = await music.resolve({
      query: item.query ?? [item.title, item.artist].filter(Boolean).join(" "),
      title: item.title,
      artist: item.artist,
      reason: item.reason ?? "Refresh playable audio URL"
    });
    if (!song?.url) {
      queue[index] = {
        ...item,
        playbackStatus: "unavailable"
      };
      return;
    }

    queue[index] = {
      ...item,
      title: song.title,
      artist: song.artist,
      url: song.url,
      source: song.source,
      playbackStatus: "ready"
    };
    syncFmNowPlayingMessage(options.fmProgram, queue[index]);
  } catch {
    // Keep the existing queue item; playback error handling remains client-visible.
  }
}

async function prefetchUpcomingSongs(
  queue: PlaybackState["queue"],
  currentIndex: number,
  music: Services["music"],
  tts: Services["tts"],
  options: { limit?: number; fmProgram?: FmProgramState } = {}
): Promise<void> {
  let prefetched = 0;
  const limit = options.limit ?? 3;

  for (let index = currentIndex + 1; index < queue.length && prefetched < limit; index += 1) {
    const item = queue[index];
    if (item?.kind === "voice" && item.fmRole === "segue") {
      await refreshVoiceUrl(queue, index, tts);
      continue;
    }

    if (item?.kind !== "song") {
      continue;
    }

    if (!item.url) {
      await refreshSongUrl(queue, index, music, { fmProgram: options.fmProgram });
    }
    if (item.url) {
      prefetched += 1;
    }
  }
}

function isRejection(text: string): boolean {
  return /不是|不符合|不对|重新|别再|不要|换一批|换一些|不想听/.test(text);
}

function avoidFromQueue(queue: PlaybackState["queue"]) {
  return queue
    .filter((item) => item.kind === "song")
    .map((item) => ({ title: item.title, artist: item.artist, query: item.title }))
    .slice(-20);
}

function uniqueAvoid(items: Array<{ title?: string; artist?: string; query?: string }>) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.title ?? item.query ?? ""}::${item.artist ?? ""}`.toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildFmMessages(queue: PlaybackState["queue"], createdAt: string): NonNullable<PlaybackState["fmProgram"]>["messages"] {
  const messages: NonNullable<PlaybackState["fmProgram"]>["messages"] = [];

  for (const item of queue) {
    if (item.fmRole === "segue") {
      messages.push({
        id: nanoid(),
        type: "segue",
        text: item.text ?? "",
        voiceItemId: item.id,
        segmentIndex: item.segmentIndex ?? 0,
        createdAt
      });
    }

    if (item.fmRole === "song") {
      messages.push({
        id: nanoid(),
        type: "nowPlaying",
        title: item.title,
        artist: item.artist,
        songItemId: item.id,
        segmentIndex: item.segmentIndex ?? 0,
        createdAt
      });
    }
  }

  return messages;
}

function normalizeTrackKey(item: { title?: string; artist?: string; query?: string }): string {
  return `${item.title ?? item.query ?? ""}::${item.artist ?? ""}`
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}:]+/gu, " ")
    .trim();
}

function maxFmSegmentIndex(queue: PlaybackState["queue"]): number {
  return queue.reduce((max, item) => Math.max(max, item.segmentIndex ?? -1), -1);
}

function filterNewFmSegments(program: ValidFmProgram, queue: PlaybackState["queue"]): ValidFmProgram {
  const seen = new Set(
    queue
      .filter((item) => item.kind === "song")
      .map((item) => normalizeTrackKey({ title: item.title, artist: item.artist, query: item.query }))
      .filter(Boolean)
  );

  return {
    ...program,
    segments: program.segments.filter((segment) => {
      const key = normalizeTrackKey({
        title: segment.track.title,
        artist: segment.track.artist,
        query: segment.track.query
      });
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
  };
}

async function appendFmContinuation(
  state: PlaybackState,
  program: ValidFmProgram,
  services: Services,
  stream: ReturnType<typeof createStreamHub>
): Promise<void> {
  if (!state.fmProgram || state.playbackMode !== "fm" || program.segments.length === 0) {
    return;
  }

  const continuation = filterNewFmSegments(program, state.queue);
  if (continuation.segments.length === 0) {
    return;
  }

  const startSegmentIndex = maxFmSegmentIndex(state.queue) + 1;
  const items = await buildFmQueue({
    program: continuation,
    programId: state.fmProgram.id,
    startSegmentIndex,
    initialSongResolveLimit: 0,
    initialVoiceSynthesisLimit: 0,
    tts: services.tts,
    music: services.music
  });
  const createdAt = new Date().toISOString();

  state.queue.push(...items);
  state.fmProgram.messages.push(...buildFmMessages(items, createdAt));
  await prefetchUpcomingSongs(state.queue, state.currentIndex, services.music, services.tts, {
    fmProgram: state.fmProgram
  });
  stream.broadcast({ type: "state", state, program: continuation });
}

function startFmContinuation(
  state: PlaybackState,
  services: Services,
  stream: ReturnType<typeof createStreamHub>,
  avoidTracks: Array<{ title?: string; artist?: string; query?: string }>
): void {
  if (!services.agent.planFmContinuation || !state.fmProgram) {
    return;
  }

  const planFmContinuation = services.agent.planFmContinuation;
  const fmProgram = state.fmProgram;
  const programId = state.fmProgram.id;
  void (async () => {
    try {
      const program = await planFmContinuation(
        fmProgram,
        state.queue,
        state.messages,
        avoidTracks
      );
      if (!state.fmProgram || state.fmProgram.id !== programId || state.playbackMode !== "fm") {
        return;
      }
      await appendFmContinuation(state, program, services, stream);
    } catch {
      // Continuation is best-effort; the already-started FM program must keep playing.
    }
  })();
}

function refersToCurrentTrack(text: string): boolean {
  return /当前|现在播放|正在播放|这首|这歌|这支歌|介绍一下|讲讲|说说|我喜欢/.test(text);
}

function withCurrentTrackTarget(
  intent: ChatIntent,
  prompt: string,
  queue: PlaybackState["queue"],
  currentIndex: number
): ChatIntent {
  const current = queue[currentIndex];
  if (intent.intent !== "song_info" || !current || current.kind !== "song" || !refersToCurrentTrack(prompt)) {
    return intent;
  }

  return {
    ...intent,
    target: {
      reference: "current",
      title: current.title,
      artist: current.artist
    }
  };
}

export async function createApp(services: Services) {
  const app = Fastify({ logger: true });
  const stream = createStreamHub();
  const state: PlaybackState = {
    queue: [],
    currentIndex: -1,
    status: "idle",
    messages: [],
    playbackMode: "chat",
    activeView: "chat"
  };
  const avoidedTracks: Array<{ title?: string; artist?: string; query?: string }> = [];

  await app.register(cors);
  await app.register(websocket);
  mkdirSync(".cache", { recursive: true });
  await app.register(staticFiles, { root: resolve(".cache"), prefix: "/.cache/" });

  app.get("/stream", { websocket: true }, (socket) => {
    stream.add(socket);
    socket.send(JSON.stringify({ type: "state", state }));
  });

  app.post<{ Body: { prompt: string } }>("/api/chat", async (request, reply) => {
    const userText = request.body.prompt.trim();
    const isFirstUserMessage = state.messages.every((message) => message.role !== "user");
    const preserveFmProgram = state.playbackMode === "fm" && Boolean(state.fmProgram);
    const previousStatus = state.status;
    state.messages.push({
      id: nanoid(),
      role: "user",
      text: userText,
      createdAt: new Date().toISOString()
    });
    if (isRejection(userText)) {
      avoidedTracks.push(...avoidFromQueue(state.queue));
    }
    if (!preserveFmProgram) {
      state.status = "planning";
    }
    state.message = undefined;
    stream.broadcast({ type: "state", state });

    try {
      const currentAvoid = uniqueAvoid([...avoidedTracks, ...avoidFromQueue(state.queue)]);
      const intent = isFirstUserMessage || !services.agent.classify
        ? { intent: "recommendation" as const, reason: "First message defaults to recommendation" }
        : await services.agent.classify(userText, state.messages, state.queue, state.currentIndex);
      const routedIntent = withCurrentTrackTarget(intent, userText, state.queue, state.currentIndex);

      if (routedIntent.intent === "song_info" && services.agent.explain) {
        const explanation = await services.agent.explain(userText, state.messages, state.queue, routedIntent, state.currentIndex);
        const voice = await buildDjVoice(explanation.say, services.tts);
        state.status = preserveFmProgram ? previousStatus : "idle";
        state.message = undefined;
        if (!preserveFmProgram) {
          state.playbackMode = "chat";
        }
        state.messages.push({
          id: nanoid(),
          role: "dj",
          text: explanation.say,
          createdAt: new Date().toISOString(),
          voice
        });
        stream.broadcast({ type: "state", state, intent: routedIntent });
        return { state, queue: state.queue, intent: routedIntent };
      }

      const plan = await services.agent.plan(userText, state.messages, currentAvoid);
      const chatQueue = await buildPlaybackQueue({
        plan: {
          ...plan,
          play: plan.play.map((track) => ({
            ...track,
            avoid: currentAvoid
          }))
        },
        tts: services.tts,
        music: services.music
      });
      const voice = chatQueue.find((item) => item.kind === "voice");
      if (!preserveFmProgram) {
        state.queue = chatQueue;
        state.currentIndex = -1;
        state.playbackMode = "chat";
      }
      state.status = preserveFmProgram ? previousStatus : "idle";
      state.messages.push({
        id: nanoid(),
        role: "dj",
        text: plan.say,
        createdAt: new Date().toISOString(),
        voice,
        recommendations: chatQueue.filter((item) => item.kind === "song")
      });
      stream.broadcast({ type: "state", state, plan });
      return { state, queue: preserveFmProgram ? chatQueue : state.queue, plan };
    } catch (error) {
      state.status = preserveFmProgram ? previousStatus : "error";
      state.message = error instanceof Error ? error.message : "Planning failed";
      stream.broadcast({ type: "state", state });
      request.log.error({ err: error }, "Radio planning failed");
      return reply.code(500).send({
        error: "Internal Server Error",
        message: state.message,
        statusCode: 500,
        state
      });
    }
  });

  app.post("/api/fm/start", async (request, reply) => {
    if (!services.agent.planFm) {
      return reply.code(503).send({ message: "FM program planning is not configured" });
    }

    state.status = "planning";
    state.message = undefined;
    state.activeView = "fm";
    stream.broadcast({ type: "state", state });

    try {
      const program = await services.agent.planFm(state.messages, uniqueAvoid([...avoidedTracks, ...avoidFromQueue(state.queue)]));
      const programId = nanoid();
      const startedAt = new Date().toISOString();
      const queue = await buildFmQueue({
        program,
        programId,
        initialSongResolveLimit: 1,
        initialVoiceSynthesisLimit: 1,
        tts: services.tts,
        music: services.music
      });

      state.queue = queue;
      state.currentIndex = await nextPlayableIndex(queue, -1, services.music, services.tts);
      state.status = state.currentIndex >= 0 ? "playing" : "idle";
      state.playbackMode = "fm";
      state.activeView = "fm";
      state.fmProgram = {
        id: programId,
        title: program.title,
        reason: program.reason,
        startedAt,
        messages: buildFmMessages(queue, startedAt)
      };

      stream.broadcast({ type: "state", state, program });
      startFmContinuation(
        state,
        services,
        stream,
        uniqueAvoid([...avoidedTracks, ...avoidFromQueue(state.queue)])
      );
      return { state, queue, program };
    } catch (error) {
      state.status = "error";
      state.message = error instanceof Error ? error.message : "FM planning failed";
      stream.broadcast({ type: "state", state });
      request.log.error({ err: error }, "FM planning failed");
      return reply.code(500).send({
        error: "Internal Server Error",
        message: state.message,
        statusCode: 500,
        state
      });
    }
  });

  app.get("/api/now", async () => state);

  app.get<{ Querystring: { itemId?: string } }>("/api/next", async (request) => {
    const current = state.queue[state.currentIndex];
    if (request.query.itemId && current?.id !== request.query.itemId) {
      return state;
    }

    const nextIndex = await nextPlayableIndex(state.queue, state.currentIndex, services.music, services.tts, state.fmProgram);
    state.currentIndex = nextIndex;
    stream.broadcast({ type: "state", state });
    await prefetchUpcomingSongs(state.queue, nextIndex, services.music, services.tts, { fmProgram: state.fmProgram });
    stream.broadcast({ type: "state", state });
    return state;
  });

  app.get("/api/previous", async () => {
    const previousIndex = await previousPlayableIndex(state.queue, state.currentIndex, services.music, services.tts, state.fmProgram);
    state.currentIndex = previousIndex;
    stream.broadcast({ type: "state", state });
    await prefetchUpcomingSongs(state.queue, previousIndex, services.music, services.tts, { fmProgram: state.fmProgram });
    stream.broadcast({ type: "state", state });
    return state;
  });

  app.post<{ Body: { itemId: string; refresh?: boolean } }>("/api/play", async (request, reply) => {
    const index = state.queue.findIndex((item) => item.id === request.body.itemId);
    if (index < 0) {
      return reply.code(404).send({ message: "Queue item not found" });
    }
    await refreshSongUrl(state.queue, index, services.music, { force: request.body.refresh, fmProgram: state.fmProgram });
    if (!state.queue[index]?.url) {
      return reply.code(409).send({ message: "Queue item is not playable" });
    }

    state.currentIndex = index;
    state.status = "playing";
    stream.broadcast({ type: "state", state });
    await prefetchUpcomingSongs(state.queue, index, services.music, services.tts, { fmProgram: state.fmProgram });
    stream.broadcast({ type: "state", state });
    return state;
  });

  app.post<{ Body: SongResolveRequest }>("/api/resolve-song", async (request, reply) => {
    const query = request.body.query?.trim();
    if (!query) {
      return reply.code(400).send({ message: "Song query is required" });
    }

    const song = await services.music.resolve(request.body);
    if (!song?.url) {
      return reply.code(404).send({ message: "Song is not playable" });
    }

    return {
      id: nanoid(),
      kind: "song" as const,
      title: song.title,
      artist: song.artist,
      query,
      url: song.url,
      reason: request.body.reason,
      source: song.source,
      playbackStatus: "ready" as const
    };
  });

  app.post("/api/stop", async () => {
    state.currentIndex = -1;
    state.status = "idle";
    state.playbackMode = "chat";
    stream.broadcast({ type: "state", state });
    return state;
  });

  app.post("/api/netease/login/qr", async (_request, reply) => {
    if (!services.netease) {
      return reply.code(503).send({ message: "Netease auth is not configured" });
    }
    return services.netease.createLoginQr();
  });

  app.get<{ Querystring: { key?: string } }>("/api/netease/login/check", async (request, reply) => {
    if (!services.netease) {
      return reply.code(503).send({ message: "Netease auth is not configured" });
    }
    if (!request.query.key) {
      return reply.code(400).send({ message: "QR login key is required" });
    }
    return services.netease.checkLogin(request.query.key);
  });

  app.get("/api/netease/login/status", async (_request, reply) => {
    if (!services.netease) {
      return reply.code(503).send({ message: "Netease auth is not configured" });
    }
    return services.netease.status();
  });

  app.post<{ Body: { cookie?: string } }>("/api/netease/session", async (request, reply) => {
    if (!services.netease) {
      return reply.code(503).send({ message: "Netease auth is not configured" });
    }
    if (!request.body.cookie) {
      return reply.code(400).send({ message: "Netease cookie is required" });
    }
    try {
      return await services.netease.importCookie(request.body.cookie);
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Invalid Netease cookie"
      });
    }
  });

  app.post("/api/netease/logout", async (_request, reply) => {
    if (!services.netease) {
      return reply.code(503).send({ message: "Netease auth is not configured" });
    }
    await services.netease.logout();
    return { loggedIn: false };
  });

  app.get("/api/taste", async () => loadUserProfile());

  app.put<{
    Body: { taste: string; routines: string; playlists: string; moodRules: string };
  }>("/api/taste", async (request) => {
    await Promise.all([
      writeTextFile("user/taste.md", request.body.taste),
      writeTextFile("user/routines.md", request.body.routines),
      writeTextFile("user/playlists.json", request.body.playlists),
      writeTextFile("user/mood-rules.md", request.body.moodRules)
    ]);
    return loadUserProfile();
  });

  app.get("/api/plan/today", async () => ({ queue: state.queue, currentIndex: state.currentIndex }));

  return app;
}

async function buildDjVoice(text: string, tts: Services["tts"]): Promise<PlaybackState["queue"][number]> {
  try {
    return {
      id: nanoid(),
      kind: "voice",
      title: "DJ Reply",
      text,
      url: await tts.synthesize(text)
    };
  } catch {
    return {
      id: nanoid(),
      kind: "voice",
      title: "DJ Reply",
      text,
      reason: "TTS audio unavailable"
    };
  }
}
