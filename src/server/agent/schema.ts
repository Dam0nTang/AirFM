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

function normalizeTrack(value: unknown): unknown {
  if (typeof value === "string") {
    return {
      query: value.trim(),
      reason: "Selected by the radio plan"
    };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const existingQuery = stringValue(record, ["query"]);
  const title = stringValue(record, ["title", "name", "song", "track"]);
  const artist = stringValue(record, ["artist", "singer", "by"]);
  const genre = stringValue(record, ["genre", "style"]);
  const query = existingQuery ?? [title, artist].filter(Boolean).join(" ");
  const reason =
    stringValue(record, ["reason", "why", "rationale", "description"]) ??
    "Selected by the radio plan";

  return {
    ...record,
    query,
    reason,
    title,
    artist,
    genre
  };
}

export const agentPlanSchema = z.object({
  say: z.string().min(1),
  play: z
    .array(z.preprocess(normalizeTrack, z.object({
      query: z.string().min(1),
      reason: z.string().min(1),
      title: z.string().optional(),
      artist: z.string().optional(),
      genre: z.string().optional()
    })))
    .min(1)
    .max(12),
  reason: z.string().min(1),
  segue: z.string().optional()
});

export type ValidAgentPlan = z.infer<typeof agentPlanSchema>;

export function parseAgentPlan(value: unknown): ValidAgentPlan {
  return agentPlanSchema.parse(value);
}
