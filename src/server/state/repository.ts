import type { RadioDatabase } from "./db";

interface SavePlanInput {
  prompt: string;
  say: string;
  reason: string;
  raw: unknown;
}

interface SavePlayInput {
  planId: number;
  kind: "voice" | "song";
  title: string;
  artist?: string;
  url?: string;
  reason?: string;
}

export interface StoredPlan {
  id: number;
  prompt: string;
  say: string;
  reason: string;
  raw_json: string;
}

export interface StoredPlay {
  id: number;
  plan_id: number | null;
  kind: string;
  title: string;
  artist: string | null;
  url: string | null;
  reason: string | null;
}

export function createRepository(db: RadioDatabase) {
  return {
    savePlan(input: SavePlanInput): number {
      const result = db
        .prepare("INSERT INTO plans (prompt, say, reason, raw_json) VALUES (?, ?, ?, ?)")
        .run(input.prompt, input.say, input.reason, JSON.stringify(input.raw));
      return Number(result.lastInsertRowid);
    },

    getLatestPlan(): StoredPlan | undefined {
      return db.prepare("SELECT * FROM plans ORDER BY id DESC LIMIT 1").get() as
        | StoredPlan
        | undefined;
    },

    savePlay(input: SavePlayInput): number {
      const result = db
        .prepare(
          "INSERT INTO plays (plan_id, kind, title, artist, url, reason) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(
          input.planId,
          input.kind,
          input.title,
          input.artist ?? null,
          input.url ?? null,
          input.reason ?? null
        );
      return Number(result.lastInsertRowid);
    },

    listRecentPlays(limit: number): StoredPlay[] {
      return db.prepare("SELECT * FROM plays ORDER BY id DESC LIMIT ?").all(limit) as StoredPlay[];
    }
  };
}
