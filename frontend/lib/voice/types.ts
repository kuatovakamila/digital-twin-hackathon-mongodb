export type Pace = "slow" | "normal" | "fast";
export type Energy = "flat" | "warm" | "sharp";
export type Manner = "clipped" | "measured" | "dismissive";

export interface Delivery {
  pace: Pace;
  energy: Energy;
  manner: Manner;
}

/** ElevenLabs `voice_settings` payload. */
export interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
  speed: number;
}

export type TurnRole = "user" | "persona" | "director" | "system";

export interface Turn {
  id: string;
  role: TurnRole;
  /** Line as spoken/heard, with any delivery tag already stripped. */
  text: string;
  /** Present on persona turns that carried a `[pace|energy|manner]` tag. */
  delivery?: Delivery;
  /** True when the line was re-delivered after a director note. */
  retake?: boolean;
  at: number;
}

/** POST /api/chat request body. Contract shared with Member 2. */
export interface ChatRequest {
  sessionId: string;
  personaId: string;
  /** "line" = Sam speaking in-scene. "note" = director correcting the persona. */
  kind: "line" | "note";
  text: string;
  history: Turn[];
}

/** POST /api/chat response body. Contract shared with Member 2. */
export interface ChatResponse {
  /** The persona's line, delivery tag included. */
  reply: string;
  /** Set when `kind: "note"` produced a stored behaviour correction. */
  correction?: {
    id: string;
    summary: string;
  };
  /** Optional: what was written to Mongo, for on-screen display. */
  memoryWrite?: {
    collection: string;
    documentId: string;
  };
  /** Set when the turn ran but persistence didn't — the scene continues, unlearned. */
  degraded?: string;
}
