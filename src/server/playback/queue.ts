import { nanoid } from "nanoid";
import type { QueueItem } from "../../shared/types";
import type { ValidFmProgram } from "../agent/fmSchema";
import type { ValidAgentPlan } from "../agent/schema";
import type { ResolvedSong, SongResolveRequest } from "../music/neteaseAdapter";

interface QueueDeps {
  plan: ValidAgentPlan;
  tts: { synthesize(text: string): Promise<string> };
  music: { resolve(request: SongResolveRequest): Promise<ResolvedSong | undefined> };
}

interface FmQueueDeps {
  program: ValidFmProgram;
  programId?: string;
  startSegmentIndex?: number;
  initialSongResolveLimit?: number;
  initialVoiceSynthesisLimit?: number;
  tts: { synthesize(text: string): Promise<string> };
  music: { resolve(request: SongResolveRequest): Promise<ResolvedSong | undefined> };
}

export async function buildPlaybackQueue(deps: QueueDeps): Promise<QueueItem[]> {
  const voicePromise = deps.tts.synthesize(deps.plan.say)
    .then<QueueItem>((voiceUrl) => ({
      id: nanoid(),
      kind: "voice",
      title: "DJ Intro",
      text: deps.plan.say,
      url: voiceUrl
    }))
    .catch<QueueItem>(() => ({
      id: nanoid(),
      kind: "voice",
      title: "DJ Intro",
      text: deps.plan.say,
      reason: "TTS audio unavailable"
    }));

  const songPromises = deps.plan.play.map(async (request): Promise<QueueItem> => {
    let song: ResolvedSong | undefined;
    try {
      song = await deps.music.resolve(request);
    } catch {
      song = undefined;
    }

    return {
      id: nanoid(),
      kind: "song",
      title: song?.title ?? request.title ?? request.query,
      artist: song?.artist ?? request.artist,
      query: request.query,
      url: song?.url,
      reason: song ? request.reason : `${request.reason} · Netease returned no playable audio`,
      source: song?.source ?? "netease",
      playbackStatus: song?.url ? "ready" : "unavailable"
    };
  });

  const [voice, ...songs] = await Promise.all([voicePromise, ...songPromises]);
  const queue = [voice, ...songs];

  return queue;
}

export async function buildFmQueue(deps: FmQueueDeps): Promise<QueueItem[]> {
  const programId = deps.programId ?? nanoid();
  const startSegmentIndex = deps.startSegmentIndex ?? 0;
  const initialSongResolveLimit = deps.initialSongResolveLimit ?? deps.program.segments.length;
  const initialVoiceSynthesisLimit = deps.initialVoiceSynthesisLimit ?? deps.program.segments.length;

  const segmentPromises = deps.program.segments.map(async (segment, index): Promise<[QueueItem, QueueItem]> => {
    const segmentIndex = startSegmentIndex + index;
    const voiceItem: QueueItem = {
      id: nanoid(),
      kind: "voice",
      title: `FM Segue ${segmentIndex + 1}`,
      text: segment.intro,
      programId,
      segmentIndex,
      fmRole: "segue"
    };

    const voicePromise = index < initialVoiceSynthesisLimit
      ? synthesizeWithRetry(deps.tts, segment.intro)
        .then<QueueItem>((url) => ({
          ...voiceItem,
          url
        }))
        .catch<QueueItem>(() => ({
          ...voiceItem,
          reason: "TTS audio unavailable"
        }))
      : Promise.resolve<QueueItem>({
        ...voiceItem,
        reason: "TTS audio pending"
      });

    const songPromise = (async (): Promise<QueueItem> => {
      let song: ResolvedSong | undefined;
      if (index < initialSongResolveLimit) {
        try {
          song = await deps.music.resolve(segment.track);
        } catch {
          song = undefined;
        }
      }

      return {
        id: nanoid(),
        kind: "song",
        title: song?.title ?? segment.track.title ?? segment.track.query,
        artist: song?.artist ?? segment.track.artist,
        query: segment.track.query,
        url: song?.url,
        reason: song || index >= initialSongResolveLimit
          ? segment.track.reason
          : `${segment.track.reason} · Netease returned no playable audio`,
        source: song?.source ?? "netease",
        programId,
        segmentIndex,
        fmRole: "song",
        playbackStatus: song?.url ? "ready" : index >= initialSongResolveLimit ? "pending" : "unavailable"
      };
    })();

    const [voice, song] = await Promise.all([voicePromise, songPromise]);
    return [voice, song];
  });

  return (await Promise.all(segmentPromises)).flat();
}

async function synthesizeWithRetry(
  tts: { synthesize(text: string): Promise<string> },
  text: string,
  attempts = 2
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await tts.synthesize(text);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("TTS audio unavailable");
}
