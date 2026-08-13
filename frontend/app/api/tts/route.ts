import { NextRequest } from "next/server";
import { deliveryToVoiceSettings, parseDelivery, shapeForSpeech } from "@/lib/voice/delivery";
import { ElevenLabsError, synthesizeStream } from "@/lib/voice/elevenlabs";

export const runtime = "nodejs";
// Audio is generated per request and never reused.
export const dynamic = "force-dynamic";

interface TtsBody {
  /** Persona line, delivery tag optional — it is stripped before synthesis. */
  text?: string;
  /** Previous persona line, for prosody continuity. */
  previousText?: string;
}

export async function POST(request: NextRequest) {
  let body: TtsBody;
  try {
    body = await request.json();
  } catch {
    return jsonError("Body must be JSON", 400);
  }

  const raw = typeof body.text === "string" ? body.text.trim() : "";
  if (!raw) {
    return jsonError("`text` is required", 400);
  }
  if (raw.length > 2000) {
    return jsonError("`text` exceeds 2000 characters", 413);
  }

  const { delivery, line } = parseDelivery(raw);
  if (!line) {
    return jsonError("`text` contained a delivery tag but no line", 400);
  }

  try {
    const audio = await synthesizeStream(
      {
        text: shapeForSpeech(line),
        voiceSettings: deliveryToVoiceSettings(delivery),
        previousText: body.previousText?.slice(-500),
      },
      request.signal,
    );

    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        // Lets the client show the delivery it is about to hear.
        "X-Delivery": `${delivery.pace}|${delivery.energy}|${delivery.manner}`,
      },
    });
  } catch (err) {
    if (request.signal.aborted) {
      // Client barged in and cancelled; nothing to report.
      return new Response(null, { status: 499 });
    }
    if (err instanceof ElevenLabsError) {
      console.error("[tts]", err.message);
      // Missing key (500), bad key (401) and quota (429) are the demo-day
      // failures worth naming; anything else is just a bad upstream.
      const passThrough = [401, 429, 500];
      const status = passThrough.includes(err.status) ? err.status : 502;
      return jsonError(err.message, status);
    }
    console.error("[tts] unexpected", err);
    return jsonError("Speech synthesis failed", 502);
  }
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}
