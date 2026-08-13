import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import {
  BackendError,
  type CounterpartContext,
  createSession,
  getContext,
  logTurn,
  submitCorrection,
  toCounterpartId,
} from "@/lib/backend";
import { getPersona } from "@/lib/personas/dana-reyes";
import { parseDelivery } from "@/lib/voice/delivery";
import type { ChatRequest, ChatResponse, Turn } from "@/lib/voice/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Orchestrates one rehearsal turn.
 *
 *   browser ──▶ this route ──▶ MongoDB (who Dana is, and what she's said)
 *                         └──▶ Claude  (what she says next)
 *
 * The persona prompt is assembled from the counterpart's stored traits rather
 * than hardcoded, so a director correction that supersedes a trait changes her
 * behaviour on the very next turn. That round trip is the product.
 */

/** Browser session id → backend session `_id`. */
const SESSIONS = new Map<string, string>();

const MODEL = process.env.CHAT_MODEL || "claude-opus-5";
const EFFORT = (process.env.CHAT_EFFORT || "low") as "low" | "medium" | "high";

export async function POST(request: NextRequest) {
  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return Response.json({ error: "`text` is required" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set" },
      { status: 500 },
    );
  }

  const counterpartId = toCounterpartId(body.personaId);
  const client = new Anthropic({ apiKey });

  // The backend is best-effort. If Mongo is down the rehearsal still runs off
  // the static persona — it just stops learning, and says so.
  let context: CounterpartContext | null = null;
  let backendSessionId: string | null = null;
  let degraded: string | undefined;

  try {
    context = await getContext(counterpartId);
    backendSessionId = await ensureSession(body.sessionId, counterpartId);
  } catch (err) {
    degraded =
      err instanceof BackendError
        ? `Memory offline (${err.message}). Corrections will not persist.`
        : "Memory offline. Corrections will not persist.";
    console.warn("[chat]", degraded);
  }

  let correction: ChatResponse["correction"];
  let memoryWrite: ChatResponse["memoryWrite"];

  if (body.kind === "note" && context && backendSessionId) {
    try {
      // The backend supersedes a trait *within a category*, so a spoken note
      // has to be resolved to the categories that actually exist. A note can
      // legitimately touch more than one: "he'd go cold, not stay chatty"
      // revises both conflict_response and conversation_style, and leaving the
      // second one stale means the old behaviour simply outvotes the new one.
      const { revisions } = await classifyNote(client, context, text);

      const applied = [];
      for (const revision of revisions) {
        const result = await submitCorrection(
          counterpartId,
          revision.category,
          revision.claim,
        );
        applied.push(result.activeTrait);
      }

      correction = {
        id: applied[0]._id,
        summary: revisions.map((r) => r.claim).join(" "),
      };
      memoryWrite = {
        collection: "traits",
        documentId:
          applied.length > 1
            ? `${applied[0]._id} +${applied.length - 1} more`
            : applied[0]._id,
      };

      // Re-read so the retake is generated against the corrected persona.
      context = await getContext(counterpartId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      console.error("[chat] correction failed:", message);
      degraded = `Could not store that correction: ${message}`;
    }
  }

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      // A rehearsal partner that pauses to deliberate stops feeling like a
      // person. Short in-character lines don't need the reasoning budget.
      thinking: { type: "disabled" },
      output_config: { effort: EFFORT },
      system: context ? buildSystem(context) : getPersona(body.personaId).systemPrompt,
      messages: toMessages(body),
    });

    if (message.stop_reason === "refusal") {
      return Response.json(
        { error: "The persona declined to respond to that." },
        { status: 422 },
      );
    }

    const reply = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!reply) {
      return Response.json({ error: "Empty reply from the model" }, { status: 502 });
    }

    if (backendSessionId) void persist(backendSessionId, body, reply);

    return Response.json({
      reply,
      correction,
      memoryWrite,
      degraded,
    } satisfies ChatResponse);
  } catch (err) {
    console.error("[chat]", err);
    const status = err instanceof Anthropic.APIError ? err.status || 502 : 502;
    return Response.json({ error: "The persona could not respond." }, { status });
  }
}

async function ensureSession(clientId: string, counterpartId: string) {
  const existing = SESSIONS.get(clientId);
  if (existing) return existing;
  const session = await createSession(counterpartId);
  SESSIONS.set(clientId, session._id);
  return session._id;
}

/** Transcript logging must never block the reply the user is waiting to hear. */
async function persist(sessionId: string, body: ChatRequest, reply: string) {
  const { delivery, line } = parseDelivery(reply);
  try {
    // A director note is not dialogue — it became a trait, not a turn.
    if (body.kind === "line") await logTurn(sessionId, "user", body.text);
    await logTurn(sessionId, "counterpart", line, delivery);
  } catch (err) {
    console.warn("[chat] turn logging failed:", err);
  }
}

/**
 * Resolves a spoken note ("she'd get quieter, not louder") to an existing
 * trait category plus a rewritten claim. Constrained to the categories the
 * counterpart actually has, so it cannot invent one the backend would reject.
 */
async function classifyNote(
  client: Anthropic,
  context: CounterpartContext,
  note: string,
): Promise<{ revisions: { category: string; claim: string }[] }> {
  const categories = context.activeTraits.map((t) => t.category);
  const current = context.activeTraits
    .map((t) => `- ${t.category}: ${t.claim}`)
    .join("\n");

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: { type: "disabled" },
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            // No minItems/maxItems — the API rejects array constraints in
            // structured-output schemas. Bounds are enforced below instead.
            revisions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string", enum: categories },
                  claim: {
                    type: "string",
                    description:
                      "The corrected trait, rewritten as a third-person " +
                      "statement about how they behave. Under 15 words.",
                  },
                },
                required: ["category", "claim"],
                additionalProperties: false,
              },
            },
          },
          required: ["revisions"],
          additionalProperties: false,
        },
      },
    },
    system:
      "You maintain a behavioural model of a person. The director just " +
      "corrected it. Revise every existing trait the correction contradicts — " +
      "usually one, but if another trait would still produce the behaviour " +
      "the director just rejected, revise that one too. Do not revise traits " +
      "the correction leaves untouched. One revision per category.",
    messages: [
      {
        role: "user",
        content: `Current traits:\n${current}\n\nDirector's correction: "${note}"`,
      },
    ],
  });

  const raw = message.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  )?.text;

  if (!raw) throw new Error("classifier returned nothing");

  const parsed = JSON.parse(raw) as {
    revisions: { category: string; claim: string }[];
  };

  // Guard the enum and de-duplicate: the backend supersedes one trait per
  // category, so two revisions of the same category would fight each other.
  const seen = new Set<string>();
  const revisions = (parsed.revisions ?? [])
    .filter((r) => {
      if (!categories.includes(r.category) || seen.has(r.category)) return false;
      seen.add(r.category);
      return true;
    })
    // One note shouldn't rewrite the whole personality.
    .slice(0, 3);

  if (revisions.length === 0) {
    throw new Error("classifier matched no known trait category");
  }
  return { revisions };
}

/** Rebuilds the character sheet from what MongoDB currently believes. */
function buildSystem(ctx: CounterpartContext): string {
  const { counterpart: c, activeTraits } = ctx;

  const claimsFor = (...categories: string[]) =>
    activeTraits
      .filter((t) => categories.includes(t.category))
      .map((t) => `- ${t.claim}`)
      .join("\n");

  const behaviour = claimsFor(
    "conflict_response",
    "conversation_style",
    "negotiation_tactic",
  );
  const hardens = claimsFor("hardening_trigger");
  const softens = claimsFor("softening_trigger");

  // Anything the seed didn't anticipate still reaches the prompt.
  const known = [
    "conflict_response",
    "conversation_style",
    "negotiation_tactic",
    "hardening_trigger",
    "softening_trigger",
  ];
  const other = activeTraits
    .filter((t) => !known.includes(t.category))
    .map((t) => `- ${t.claim}`)
    .join("\n");

  const them = c.userRole ? `the person you are speaking with (${c.userRole})` : "the other person";

  return `You are ${c.name}, ${c.role}.
${c.scenario}
You are speaking with ${c.userRole || "the other person"}.
Never mention being an AI. Never break character.

BEHAVIOR
${behaviour}${other ? `\n${other}` : ""}

STANCE
Wants: ${c.wants}
Will concede: ${c.concessions.join("; ")}
Never concedes: ${c.boundaries.join("; ")}
If pushed: ${c.escalation}

REACTIONS
Hardens: ${hardens || "- (none recorded)"}
Softens: ${softens || "- (none recorded)"}

SPEECH
Under ${c.speechRules.maximumWords} words.${
    c.speechRules.fragmentsWhenTense ? " Fragments when tense." : ""
  }${c.speechRules.usesFiller ? "" : " No filler."}

DELIVERY
Start every reply with [pace|energy|manner], then the line.
  pace: slow | normal | fast
  energy: flat | warm | sharp
  manner: clipped | measured | dismissive
Use "..." to trail off, "—" to cut yourself off.

RULES
Do not resolve this. Do not soften because ${them} argued well once.
Concede only from the list, only after three turns of pressure.
Never coach ${them}. Never say "that's fair."
Do not include internal or system XML tags in your response.
Output only the delivery tag and the line.`;
}

function toMessages(body: ChatRequest): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];

  for (const turn of body.history as Turn[]) {
    if (turn.role === "user") messages.push({ role: "user", content: turn.text });
    else if (turn.role === "persona")
      messages.push({ role: "assistant", content: turn.text });
  }

  if (body.kind === "note") {
    messages.push({
      role: "user",
      content:
        "[The director has corrected you. Deliver your last line again, " +
        "the way the correction says you would. Same intent, new delivery.]",
    });
  } else {
    messages.push({ role: "user", content: body.text });
  }

  while (messages.length > 0 && messages[0].role === "assistant") messages.shift();
  return messages;
}
