import type { VoiceSettings } from "./types";

const API_BASE = "https://api.elevenlabs.io/v1";

/** Rachel. */
export const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
export const DEFAULT_MODEL_ID = "eleven_turbo_v2_5";

/**
 * 32kbps keeps time-to-first-byte low over a conference wifi connection.
 * It is a rehearsal partner heard through laptop speakers, not a master.
 */
export const OUTPUT_FORMAT = "mp3_22050_32";

export interface SynthesisRequest {
  text: string;
  voiceSettings: VoiceSettings;
  /** Previous line, so Turbo carries prosody across turns. */
  previousText?: string;
}

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ElevenLabsError";
  }
}

/**
 * Calls the streaming TTS endpoint and hands back the raw audio stream so the
 * route can pipe it straight to the browser without buffering the whole clip.
 */
export async function synthesizeStream(
  req: SynthesisRequest,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new ElevenLabsError("ELEVENLABS_API_KEY is not set", 500);
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const modelId = process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL_ID;

  const url = `${API_BASE}/text-to-speech/${voiceId}/stream?output_format=${OUTPUT_FORMAT}`;

  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: req.text,
      model_id: modelId,
      voice_settings: req.voiceSettings,
      ...(req.previousText ? { previous_text: req.previousText } : {}),
    }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new ElevenLabsError(
      `ElevenLabs ${res.status}: ${detail.slice(0, 500) || res.statusText}`,
      res.status,
    );
  }

  return res.body;
}
