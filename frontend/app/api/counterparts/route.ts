import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import {
  BackendError,
  type CounterpartDraft,
  createCounterpart,
  listCounterparts,
} from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Trait categories the app knows how to correct. A new person must have one
 * claim per category, otherwise a Director Interrupt about (say) what softens
 * them would have no trait to supersede.
 */
const CATEGORIES = [
  "conflict_response",
  "conversation_style",
  "negotiation_tactic",
  "hardening_trigger",
  "softening_trigger",
] as const;

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Their full name." },
    role: { type: "string", description: "Their role, e.g. 'Landlord of your building'." },
    userRole: {
      type: "string",
      description: "Who the rehearsing user is in this scene, e.g. 'his tenant of four years'.",
    },
    scenario: {
      type: "string",
      description: "One sentence, third person, naming the situation and what is at stake.",
    },
    wants: { type: "string", description: "What they want out of this conversation." },
    concessions: {
      type: "array",
      items: { type: "string" },
      description: "What they will give up, under pressure.",
    },
    boundaries: {
      type: "array",
      items: { type: "string" },
      description: "What they will never agree to.",
    },
    escalation: { type: "string", description: "What they do if pushed too far." },
    speechRules: {
      type: "object",
      properties: {
        maximumWords: { type: "integer" },
        fragmentsWhenTense: { type: "boolean" },
        usesFiller: { type: "boolean" },
      },
      required: ["maximumWords", "fragmentsWhenTense", "usesFiller"],
      additionalProperties: false,
    },
    traits: {
      type: "object",
      properties: Object.fromEntries(
        CATEGORIES.map((category) => [
          category,
          {
            type: "object",
            properties: {
              claim: {
                type: "string",
                description: "Third-person statement about how they behave. Under 15 words.",
              },
              confidence: { type: "number" },
            },
            required: ["claim", "confidence"],
            additionalProperties: false,
          },
        ]),
      ),
      required: [...CATEGORIES],
      additionalProperties: false,
    },
  },
  required: [
    "name",
    "role",
    "userRole",
    "scenario",
    "wants",
    "concessions",
    "boundaries",
    "escalation",
    "speechRules",
    "traits",
  ],
  additionalProperties: false,
} as const;

/**
 * Turns a free-text description of someone into a stored counterpart.
 *
 * The user describes a person in their own words; Claude resolves that into
 * the structured body the backend needs, including one trait per correctable
 * category. Anything the description doesn't cover is inferred rather than
 * left blank — a persona with empty boundaries has nothing to hold on to.
 */
export async function POST(request: NextRequest) {
  let description: string;
  try {
    const body = await request.json();
    description = typeof body.description === "string" ? body.description.trim() : "";
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  if (!description) {
    return Response.json({ error: "`description` is required" }, { status: 400 });
  }
  if (description.length > 4000) {
    return Response.json({ error: "`description` is too long" }, { status: 413 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 500 });
  }

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: process.env.CHAT_MODEL || "claude-opus-5",
      max_tokens: 2048,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema: DRAFT_SCHEMA } },
      system:
        "You build behavioural models of people for rehearsal practice. Given " +
        "a description of someone and a situation, produce a model of how they " +
        "behave in it. Stay concrete and specific to this person — no generic " +
        "traits that would fit anyone. Where the description is silent, infer " +
        "something plausible for this role and situation rather than hedging. " +
        "These are practice personas, not real people; give them firm positions " +
        "so there is something to push against.",
      messages: [{ role: "user", content: description }],
    });

    if (message.stop_reason === "refusal") {
      return Response.json(
        { error: "Could not build a persona from that description." },
        { status: 422 },
      );
    }

    const raw = message.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text",
    )?.text;
    if (!raw) throw new Error("model returned nothing");

    const draft = JSON.parse(raw) as CounterpartDraft;
    const created = await createCounterpart(draft);

    return Response.json(
      {
        counterpart: {
          _id: created.counterpart._id,
          name: created.counterpart.name,
          role: created.counterpart.role,
          scenario: created.counterpart.scenario,
          userRole: created.counterpart.userRole,
          activeTraits: created.traits.length,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create the persona";
    const status =
      err instanceof BackendError
        ? err.status
        : err instanceof Anthropic.APIError
          ? err.status || 502
          : 502;
    console.error("[counterparts:create]", message);
    return Response.json({ error: message }, { status });
  }
}

/**
 * Who you can rehearse against. Proxied rather than called from the browser so
 * the Express backend can stay on localhost and the app keeps one origin.
 */
export async function GET() {
  try {
    const { counterparts } = await listCounterparts();
    return Response.json({ counterparts });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 502;
    const message = err instanceof Error ? err.message : "Backend unavailable";
    console.error("[counterparts]", message);
    return Response.json({ error: message, counterparts: [] }, { status });
  }
}
