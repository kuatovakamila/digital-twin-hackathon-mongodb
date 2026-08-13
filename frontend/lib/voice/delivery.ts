import type { Delivery, Energy, Manner, Pace, VoiceSettings } from "./types";

const PACES: Pace[] = ["slow", "normal", "fast"];
const ENERGIES: Energy[] = ["flat", "warm", "sharp"];
const MANNERS: Manner[] = ["clipped", "measured", "dismissive"];

export const DEFAULT_DELIVERY: Delivery = {
  pace: "normal",
  energy: "flat",
  manner: "measured",
};

/** Leading `[pace|energy|manner]` tag, tolerant of spacing and case. */
const TAG = /^\s*\[\s*([a-z]+)\s*\|\s*([a-z]+)\s*\|\s*([a-z]+)\s*\]\s*/i;

/**
 * Splits a persona reply into its delivery tag and the words actually spoken.
 * The tag must never reach the TTS engine — it would be read aloud.
 */
export function parseDelivery(raw: string): { delivery: Delivery; line: string } {
  const match = raw.match(TAG);
  if (!match) {
    return { delivery: DEFAULT_DELIVERY, line: raw.trim() };
  }

  const [pace, energy, manner] = match.slice(1, 4).map((s) => s.toLowerCase());
  return {
    delivery: {
      pace: (PACES as string[]).includes(pace) ? (pace as Pace) : DEFAULT_DELIVERY.pace,
      energy: (ENERGIES as string[]).includes(energy) ? (energy as Energy) : DEFAULT_DELIVERY.energy,
      manner: (MANNERS as string[]).includes(manner) ? (manner as Manner) : DEFAULT_DELIVERY.manner,
    },
    line: raw.slice(match[0].length).trim(),
  };
}

/**
 * Maps a delivery tag onto ElevenLabs voice settings.
 *
 * `stability` is inverted from intuition: high means monotone and consistent,
 * low means emotionally variable. Dana goes *quieter and flatter* when annoyed,
 * so "sharp" lowers stability rather than raising volume.
 */
export function deliveryToVoiceSettings(delivery: Delivery): VoiceSettings {
  const settings: VoiceSettings = {
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.0,
    use_speaker_boost: true,
    speed: 1.0,
  };

  switch (delivery.energy) {
    case "flat":
      settings.stability = 0.88;
      settings.style = 0.0;
      break;
    case "warm":
      settings.stability = 0.45;
      settings.style = 0.35;
      break;
    case "sharp":
      settings.stability = 0.28;
      settings.style = 0.55;
      break;
  }

  switch (delivery.pace) {
    case "slow":
      settings.speed = 0.85;
      break;
    case "normal":
      settings.speed = 1.0;
      break;
    case "fast":
      settings.speed = 1.1;
      break;
  }

  switch (delivery.manner) {
    case "clipped":
      // Tighter and a touch quicker, but not emotive.
      settings.speed = clamp(settings.speed + 0.05, 0.7, 1.2);
      settings.stability = settings.stability + 0.1;
      break;
    case "measured":
      break;
    case "dismissive":
      settings.style = settings.style + 0.15;
      settings.speed = clamp(settings.speed + 0.03, 0.7, 1.2);
      break;
  }

  // Past ~0.9 stability the voice flattens into text-to-speech monotone, and
  // past ~0.6 style the engine starts slurring words. Both ruin a take.
  settings.stability = clamp(settings.stability, 0, 0.9);
  settings.style = clamp(settings.style, 0, 0.6);
  settings.speed = clamp(settings.speed, 0.7, 1.2);
  return settings;
}

/**
 * Turns "..." and "—" into pauses the engine actually honours.
 * ElevenLabs respects punctuation timing but ignores a bare em dash.
 */
export function shapeForSpeech(line: string): string {
  return line
    .replace(/\s*—\s*/g, "— ")
    .replace(/\.{3,}/g, "... ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
