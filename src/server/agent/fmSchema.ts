import { z } from "zod";

function stringValue(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeSegment(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const track = record.track;
  if (!track || typeof track !== "object" || Array.isArray(track)) {
    return value;
  }

  const trackRecord = track as Record<string, unknown>;
  const title = stringValue(trackRecord, ["title", "name", "song", "track"]);
  const artist = stringValue(trackRecord, ["artist", "singer", "by"]);
  const query = stringValue(trackRecord, ["query"]) ?? [title, artist].filter(Boolean).join(" ");
  const reason =
    stringValue(trackRecord, ["reason", "why", "rationale", "description"]) ??
    "Selected by the FM program";

  return {
    ...record,
    track: {
      ...trackRecord,
      query,
      title,
      artist,
      reason
    }
  };
}

export const fmProgramSchema = z.object({
  title: z.string().min(1),
  reason: z.string().min(1),
  segments: z
    .array(z.preprocess(normalizeSegment, z.object({
      intro: z.string().min(1),
      track: z.object({
        query: z.string().min(1),
        reason: z.string().min(1),
        title: z.string().optional(),
        artist: z.string().optional(),
        genre: z.string().optional()
      })
    })))
    .min(1)
    .max(12)
});

export type ValidFmProgram = z.infer<typeof fmProgramSchema>;

export function parseFmProgram(value: unknown): ValidFmProgram {
  return fmProgramSchema.parse(value);
}
