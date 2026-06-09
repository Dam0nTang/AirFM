import { z } from "zod";

export const chatIntentSchema = z.object({
  intent: z.enum(["recommendation", "song_info"]),
  target: z
    .object({
      title: z.string().optional(),
      artist: z.string().optional(),
      reference: z.string().optional()
    })
    .optional(),
  reason: z.string().min(1).optional()
});

export const songInfoSchema = z.object({
  say: z.string().min(1),
  reason: z.string().min(1).optional()
});

export type ChatIntent = z.infer<typeof chatIntentSchema>;
export type SongInfoResponse = z.infer<typeof songInfoSchema>;

export function parseChatIntent(value: unknown): ChatIntent {
  return chatIntentSchema.parse(value);
}

export function parseSongInfo(value: unknown): SongInfoResponse {
  return songInfoSchema.parse(value);
}
