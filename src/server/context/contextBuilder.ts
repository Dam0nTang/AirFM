import type { UserProfile } from "./profile";

interface RecentPlay {
  title: string;
  artist?: string;
}

interface ConversationEntry {
  role: "user" | "dj" | "system";
  text: string;
}

interface AvoidTrack {
  title?: string;
  artist?: string;
  query?: string;
}

interface QueueContextItem {
  kind: "voice" | "song";
  title: string;
  artist?: string;
  text?: string;
  reason?: string;
}

interface BuildContextInput {
  persona: string;
  profile: UserProfile;
  now: Date;
  recentPlays: RecentPlay[];
  userPrompt: string;
  weather?: string;
  conversation?: ConversationEntry[];
  avoidTracks?: AvoidTrack[];
}

interface FmProgramContinuationInput extends Omit<BuildContextInput, "userPrompt"> {
  program: {
    title: string;
    reason: string;
    lastTrack?: RecentPlay;
    plannedTracks: Array<RecentPlay & { query?: string }>;
  };
}

function formatLocalEnvironmentTime(now: Date): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const display = now.toLocaleString([], {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short"
  });

  return [
    `Local display time: ${display}`,
    `Local timezone: ${timeZone}`,
    "Time-of-day words must match the local display time above. Do not infer morning, afternoon, evening, or late night from UTC/ISO time."
  ].join("\n");
}

export function buildContextPrompt(input: BuildContextInput): string {
  const recent = input.recentPlays
    .map((play) => `- ${play.title}${play.artist ? ` / ${play.artist}` : ""}`)
    .join("\n");
  const conversation = (input.conversation ?? [])
    .slice(-8)
    .map((message) => `${message.role}: ${message.text}`)
    .join("\n");
  const avoidTracks = (input.avoidTracks ?? [])
    .slice(-20)
    .map((track) => `- ${track.title ?? track.query}${track.artist ? ` / ${track.artist}` : ""}`)
    .join("\n");

  return [
    "## System DJ Persona",
    input.persona,
    "## User Taste",
    input.profile.taste,
    "## User Routines",
    input.profile.routines,
    "## Playlist Seeds",
    input.profile.playlists,
    "## Mood Rules",
    input.profile.moodRules,
    "## Current Environment",
    formatLocalEnvironmentTime(input.now),
    `Weather: ${input.weather ?? "unavailable"}`,
    "## Recent Plays",
    recent || "No recent plays.",
    "## Recent Conversation",
    conversation || "No previous conversation.",
    "## Do Not Recommend",
    avoidTracks || "No rejected tracks yet.",
    "## User Prompt",
    input.userPrompt,
    "Return strict JSON only. Use this exact shape: {\"say\":\"short DJ speech based on the final intended songs\",\"play\":[{\"title\":\"exact song title\",\"artist\":\"exact artist or band\",\"genre\":\"specific genre such as classic rock\",\"query\":\"exact song title and artist\",\"reason\":\"why it fits the user request\"}],\"reason\":\"overall plan reason\",\"segue\":\"optional transition\"}. Do not use markdown. Do not put genre descriptions in query. For classic rock requests, choose real classic rock artists and exact songs, not DJ/remix/network tracks."
  ].join("\n\n");
}

export function buildFmProgramPrompt(input: Omit<BuildContextInput, "userPrompt"> & { programPrompt?: string }): string {
  const recent = input.recentPlays
    .map((play) => `- ${play.title}${play.artist ? ` / ${play.artist}` : ""}`)
    .join("\n");
  const conversation = (input.conversation ?? [])
    .slice(-8)
    .map((message) => `${message.role}: ${message.text}`)
    .join("\n");
  const avoidTracks = (input.avoidTracks ?? [])
    .slice(-20)
    .map((track) => `- ${track.title ?? track.query}${track.artist ? ` / ${track.artist}` : ""}`)
    .join("\n");

  return [
    "## System DJ Persona",
    input.persona,
    "## Task",
    "Return only one JSON object. Do not add greetings, explanations, headings, markdown fences, or prose before or after the JSON.",
    "Create a continuous FM radio program. For every song, write a short spoken DJ segue that introduces that exact next song. The segue must mention the song or artist naturally, and should fit the user's taste, current time, weather, routines, and mood rules.",
    "## User Taste",
    input.profile.taste,
    "## User Routines",
    input.profile.routines,
    "## Playlist Seeds",
    input.profile.playlists,
    "## Mood Rules",
    input.profile.moodRules,
    "## Current Environment",
    formatLocalEnvironmentTime(input.now),
    `Weather: ${input.weather ?? "unavailable"}`,
    "## Recent Plays",
    recent || "No recent plays.",
    "## Recent Conversation",
    conversation || "No previous conversation.",
    "## Do Not Recommend",
    avoidTracks || "No rejected tracks yet.",
    "## Program Direction",
    input.programPrompt ?? "Start a short personal FM program for right now.",
    "Return strict JSON only. Use this exact shape: {\"title\":\"short FM program title\",\"reason\":\"why this program fits now\",\"segments\":[{\"intro\":\"spoken DJ segue for the next exact song\",\"track\":{\"title\":\"exact song title\",\"artist\":\"exact artist or band\",\"genre\":\"specific genre\",\"query\":\"exact song title and artist\",\"reason\":\"why it fits this program\"}}]}. Do not use markdown. Generate 4 to 8 segments. Do not put genre descriptions in query. Avoid duplicate artists unless the user profile strongly asks for them."
  ].join("\n\n");
}

function buildFmBaseSections(input: Omit<BuildContextInput, "userPrompt">): string[] {
  const recent = input.recentPlays
    .map((play) => `- ${play.title}${play.artist ? ` / ${play.artist}` : ""}`)
    .join("\n");
  const conversation = (input.conversation ?? [])
    .slice(-8)
    .map((message) => `${message.role}: ${message.text}`)
    .join("\n");
  const avoidTracks = (input.avoidTracks ?? [])
    .slice(-30)
    .map((track) => `- ${track.title ?? track.query}${track.artist ? ` / ${track.artist}` : ""}`)
    .join("\n");

  return [
    "## System DJ Persona",
    input.persona,
    "## User Taste",
    input.profile.taste,
    "## User Routines",
    input.profile.routines,
    "## Playlist Seeds",
    input.profile.playlists,
    "## Mood Rules",
    input.profile.moodRules,
    "## Current Environment",
    formatLocalEnvironmentTime(input.now),
    `Weather: ${input.weather ?? "unavailable"}`,
    "## Recent Plays",
    recent || "No recent plays.",
    "## Recent Conversation",
    conversation || "No previous conversation.",
    "## Do Not Recommend",
    avoidTracks || "No rejected tracks yet."
  ];
}

export function buildFmFirstSegmentPrompt(input: Omit<BuildContextInput, "userPrompt">): string {
  return [
    ...buildFmBaseSections(input),
    "## Task",
    "Start a personal FM radio program for right now.",
    "Generate exactly 1 segment so playback can begin quickly.",
    "The intro must introduce the next exact song and naturally mention the song or artist.",
    "Return only one JSON object. Do not add greetings, explanations, headings, markdown fences, or prose before or after the JSON.",
    "Return strict JSON only. Use this exact shape: {\"title\":\"short FM program title\",\"reason\":\"why this program fits now\",\"segments\":[{\"intro\":\"spoken DJ segue for the next exact song\",\"track\":{\"title\":\"exact song title\",\"artist\":\"exact artist or band\",\"genre\":\"specific genre\",\"query\":\"exact song title and artist\",\"reason\":\"why it fits this program\"}}]}. Generate exactly 1 segment. Do not put genre descriptions in query. The query must be only exact song title and artist."
  ].join("\n\n");
}

export function buildFmContinuationPrompt(input: FmProgramContinuationInput): string {
  const plannedTracks = input.program.plannedTracks
    .map((track) => `- ${track.title}${track.artist ? ` / ${track.artist}` : ""}${track.query ? ` (${track.query})` : ""}`)
    .join("\n");

  return [
    ...buildFmBaseSections(input),
    "## Existing FM Program",
    `Title: ${input.program.title}`,
    `Reason: ${input.program.reason}`,
    `Last track: ${input.program.lastTrack ? `${input.program.lastTrack.title}${input.program.lastTrack.artist ? ` / ${input.program.lastTrack.artist}` : ""}` : "No track has played yet."}`,
    "Already planned tracks:",
    plannedTracks || "No tracks planned yet.",
    "## Task",
    "Continue the existing FM radio program with a coherent next act.",
    "Generate 3 to 5 segments that continue the same mood, host voice, and musical arc.",
    "The first continuation intro must naturally connect from the last track into the next exact song.",
    "Do not repeat any already planned tracks or artists unless strongly justified by the user profile.",
    "Return only one JSON object. Do not add greetings, explanations, headings, markdown fences, or prose before or after the JSON.",
    "Return strict JSON only. Use this exact shape: {\"title\":\"same or compatible FM program title\",\"reason\":\"why this continuation fits\",\"segments\":[{\"intro\":\"spoken DJ segue for the next exact song\",\"track\":{\"title\":\"exact song title\",\"artist\":\"exact artist or band\",\"genre\":\"specific genre\",\"query\":\"exact song title and artist\",\"reason\":\"why it fits this program\"}}]}. Generate 3 to 5 segments. Do not put genre descriptions in query. The query must be only exact song title and artist."
  ].join("\n\n");
}

export function buildIntentPrompt(input: {
  userPrompt: string;
  conversation: ConversationEntry[];
  queue: QueueContextItem[];
  current?: QueueContextItem;
}): string {
  return [
    "Classify the user's latest message for a music radio DJ app.",
    "Use intent \"recommendation\" when the user asks for songs, a playlist, more recommendations, a replacement set, or a refinement of the current set.",
    "Use intent \"song_info\" when the user asks about a specific song's creator, release date, genre, background, meaning, musical traits, or why it was recommended.",
    "Current recommendations:",
    formatSongQueue(input.queue),
    "Current playing song:",
    formatCurrentSong(input.current),
    "Recent conversation:",
    input.conversation.slice(-8).map((message) => `${message.role}: ${message.text}`).join("\n") || "No previous conversation.",
    "Latest user message:",
    input.userPrompt,
    "Return strict JSON only: {\"intent\":\"recommendation|song_info\",\"target\":{\"title\":\"optional\",\"artist\":\"optional\",\"reference\":\"current|last|index:1|title\"},\"reason\":\"short reason\"}."
  ].join("\n\n");
}

export function buildSongInfoPrompt(input: {
  persona: string;
  userPrompt: string;
  conversation: ConversationEntry[];
  queue: QueueContextItem[];
  current?: QueueContextItem;
  target?: { title?: string; artist?: string; reference?: string };
}): string {
  return [
    "## System DJ Persona",
    input.persona,
    "## Task",
    "Answer the user's question about a song like a knowledgeable, concise radio DJ. Do not recommend a new playlist. Do not invent exact dates if uncertain; say approximate era or album context when needed.",
    "## Current Recommendations",
    formatSongQueue(input.queue),
    "## Current Playing Song",
    formatCurrentSong(input.current),
    "## Target",
    input.target
      ? `${input.target.reference ?? "unspecified"} ${input.target.title ?? ""}${input.target.artist ? ` / ${input.target.artist}` : ""}`.trim()
      : "unspecified",
    "## Recent Conversation",
    input.conversation.slice(-8).map((message) => `${message.role}: ${message.text}`).join("\n") || "No previous conversation.",
    "## User Prompt",
    input.userPrompt,
    "Return strict JSON only: {\"say\":\"DJ explanation answer\",\"reason\":\"why this answers the user\"}."
  ].join("\n\n");
}

function formatSongQueue(queue: QueueContextItem[]): string {
  const songs = queue.filter((item) => item.kind === "song");
  return songs
    .map((item, index) => `${index + 1}. ${item.title}${item.artist ? ` / ${item.artist}` : ""}${item.reason ? ` - ${item.reason}` : ""}`)
    .join("\n") || "No current recommendations.";
}

function formatCurrentSong(current?: QueueContextItem): string {
  if (!current || current.kind !== "song") {
    return "No song is currently playing.";
  }
  return `${current.title}${current.artist ? ` / ${current.artist}` : ""}${current.reason ? ` - ${current.reason}` : ""}`;
}
