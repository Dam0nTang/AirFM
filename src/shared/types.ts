export type QueueKind = "voice" | "song";
export type PlaybackMode = "chat" | "fm";
export type ActiveView = "chat" | "fm";

export interface QueueItem {
  id: string;
  kind: QueueKind;
  title: string;
  artist?: string;
  query?: string;
  url?: string;
  text?: string;
  reason?: string;
  source?: string;
  programId?: string;
  segmentIndex?: number;
  fmRole?: "segue" | "song";
  playbackStatus?: "pending" | "ready" | "unavailable";
}

export interface ChatMessage {
  id: string;
  role: "user" | "dj" | "system";
  text: string;
  createdAt: string;
  voice?: QueueItem;
  recommendations?: QueueItem[];
}

export interface AgentTrackRequest {
  query: string;
  reason: string;
}

export interface AgentPlan {
  say: string;
  play: AgentTrackRequest[];
  reason: string;
  segue?: string;
}

export type FmMessage =
  | {
      id: string;
      type: "segue";
      text: string;
      voiceItemId: string;
      segmentIndex: number;
      createdAt: string;
    }
  | {
      id: string;
      type: "nowPlaying";
      title: string;
      artist?: string;
      songItemId: string;
      segmentIndex: number;
      createdAt: string;
    };

export interface FmProgram {
  id: string;
  title: string;
  reason: string;
  startedAt: string;
  messages: FmMessage[];
}

export interface PlaybackState {
  queue: QueueItem[];
  currentIndex: number;
  status: "idle" | "planning" | "playing" | "error";
  message?: string;
  messages: ChatMessage[];
  playbackMode: PlaybackMode;
  activeView: ActiveView;
  fmProgram?: FmProgram;
}
