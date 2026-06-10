export interface ResolvedSong {
  title: string;
  artist?: string;
  url: string;
  source: "netease";
}

export interface SongResolveRequest {
  query: string;
  reason?: string;
  title?: string;
  artist?: string;
  genre?: string;
  avoid?: Array<{ title?: string; artist?: string; query?: string }>;
}

export interface NeteaseResolveOptions {
  cookie?: string;
}

interface NeteaseSearchSong {
  id: number;
  name: string;
  artists?: Array<{ name: string }>;
  ar?: Array<{ name: string }>;
}

interface NeteaseSearchResponse {
  result?: {
    songs?: NeteaseSearchSong[];
  };
}

interface NeteaseUrlResponse {
  data?: Array<{ url?: string }>;
}

const URL_LOOKUP_TIMEOUT_MS = 6000;

export async function resolveNeteaseSong(
  baseUrl: string,
  request: string | SongResolveRequest,
  options: NeteaseResolveOptions = {}
): Promise<ResolvedSong | undefined> {
  const resolveRequest = typeof request === "string" ? { query: request } : request;
  const rankedSongs = await findRankedCandidates(baseUrl, resolveRequest, options);

  for (const song of rankedSongs) {
    const songUrl = await fetchSongUrl(baseUrl, song.id, options);
    if (!songUrl) {
      continue;
    }

    const artists = song.artists ?? song.ar ?? [];
    return {
      title: song.name,
      artist: artists.map((artist) => artist.name).join(", ") || undefined,
      url: songUrl,
      source: "netease"
    };
  }

  return undefined;
}

async function findRankedCandidates(
  baseUrl: string,
  request: SongResolveRequest,
  options: NeteaseResolveOptions
): Promise<NeteaseSearchSong[]> {
  const cloudSongs = await searchSongs(baseUrl, "/cloudsearch", request.query, options);
  const cloudCandidates = rankCandidates(cloudSongs, request);
  if (cloudCandidates.length > 0) {
    return cloudCandidates;
  }

  const fallbackSongs = await searchSongs(baseUrl, "/search", request.query, options);
  return rankCandidates(fallbackSongs, request);
}

async function searchSongs(
  baseUrl: string,
  path: "/cloudsearch" | "/search",
  query: string,
  options: NeteaseResolveOptions
): Promise<NeteaseSearchSong[]> {
  const searchUrl = new URL(path, baseUrl);
  searchUrl.searchParams.set("keywords", query);
  searchUrl.searchParams.set("limit", "10");
  appendCookie(searchUrl, options);

  const search = await fetch(searchUrl);
  if (!search.ok) {
    return [];
  }

  const searchJson = (await search.json()) as NeteaseSearchResponse;
  return searchJson.result?.songs ?? [];
}

async function fetchSongUrl(
  baseUrl: string,
  songId: number,
  options: NeteaseResolveOptions
): Promise<string | undefined> {
  return (
    (await fetchUrlFromEndpoint(baseUrl, "/song/url", songId, options)) ??
    fetchUrlFromEndpoint(baseUrl, "/song/url/v1", songId, options)
  );
}

async function fetchUrlFromEndpoint(
  baseUrl: string,
  path: "/song/url/v1" | "/song/url",
  songId: number,
  options: NeteaseResolveOptions
): Promise<string | undefined> {
  const url = new URL(path, baseUrl);
  url.searchParams.set("id", String(songId));
  if (path === "/song/url/v1") {
    url.searchParams.set("level", "standard");
  }
  appendCookie(url, options);

  let urlResponse: Response;
  try {
    urlResponse = await fetch(url, { signal: AbortSignal.timeout(URL_LOOKUP_TIMEOUT_MS) });
  } catch {
    return undefined;
  }

  if (!urlResponse.ok) {
    return undefined;
  }

  const urlJson = (await urlResponse.json()) as NeteaseUrlResponse;
  return urlJson.data?.[0]?.url;
}

function appendCookie(url: URL, options: NeteaseResolveOptions): void {
  if (options.cookie) {
    url.searchParams.set("cookie", options.cookie);
  }
}

function rankCandidates(
  songs: NeteaseSearchSong[],
  request: SongResolveRequest
): NeteaseSearchSong[] {
  return songs
    .map((song, index) => ({ song, score: scoreCandidate(song, request) - index * 0.01 }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.song);
}

function scoreCandidate(song: NeteaseSearchSong, request: SongResolveRequest): number {
  const title = normalize(song.name);
  const artists = (song.artists ?? song.ar ?? []).map((artist) => normalize(artist.name));
  const expectedTitle = normalize(request.title ?? request.query);
  const expectedArtist = normalize(request.artist ?? "");
  const query = normalize(request.query);
  let score = 0;
  const artistMatches = !expectedArtist || artists.some((artist) => artist === expectedArtist || artist.includes(expectedArtist) || expectedArtist.includes(artist));
  const titleMatches = title === expectedTitle || title.includes(expectedTitle) || expectedTitle.includes(title);

  if (expectedArtist && !artistMatches) {
    return -20;
  }

  if (request.title?.trim() && !titleMatches) {
    return -20;
  }

  if (title === expectedTitle) {
    score += 8;
  } else if (titleMatches) {
    score += 4;
  }

  if (expectedArtist && artists.some((artist) => artist === expectedArtist)) {
    score += 8;
  } else if (expectedArtist && artistMatches) {
    score += 4;
  }

  if (query.includes(title)) {
    score += 2;
  }

  if (isBadVersion(song.name)) {
    score -= 6;
  }

  if (isAvoided(song, request)) {
    score -= 20;
  }

  return score;
}

function isBadVersion(title: string): boolean {
  return /dj|remix|伴奏|翻唱|片段|加速| slowed |live版/i.test(title);
}

function isAvoided(song: NeteaseSearchSong, request: SongResolveRequest): boolean {
  const title = normalize(song.name);
  const artists = (song.artists ?? song.ar ?? []).map((artist) => normalize(artist.name)).join(" ");
  return (request.avoid ?? []).some((item) => {
    const avoidedTitle = normalize(item.title ?? item.query ?? "");
    const avoidedArtist = normalize(item.artist ?? "");
    return Boolean(avoidedTitle) && title.includes(avoidedTitle) && (!avoidedArtist || artists.includes(avoidedArtist));
  });
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}
