/**
 * Counterpart data layer, backed by MongoDB Atlas.
 *
 * Only the Next.js route layer imports this — never the browser, since it
 * holds a live database connection. It replaces the Express server in
 * backend/index.js, whose endpoints and validation this mirrors one-for-one so
 * the app runs as a single Vercel deployment.
 */

import { randomUUID } from "node:crypto";
import { getClient, getDb } from "@/lib/mongo";

export interface Counterpart {
  _id: string;
  name: string;
  role: string;
  scenario: string;
  /** Who *you* are in this scene, e.g. "his tenant of four years". */
  userRole?: string;
  wants: string;
  concessions: string[];
  boundaries: string[];
  escalation: string;
  speechRules: {
    maximumWords: number;
    fragmentsWhenTense: boolean;
    usesFiller: boolean;
  };
}

/** Summary shape returned by the list endpoint. */
export interface CounterpartSummary {
  _id: string;
  name: string;
  role: string;
  scenario: string;
  userRole?: string;
  activeTraits: number;
}

export interface Trait {
  _id: string;
  counterpartId: string;
  category: string;
  claim: string;
  confidence: number;
  status: "active" | "superseded";
  version: number;
  evidenceIds: string[];
  supersedes?: string;
}

export interface Evidence {
  _id: string;
  counterpartId: string;
  type: string;
  content: string;
  source: string;
  reliability: number;
}

export interface CounterpartContext {
  counterpart: Counterpart;
  activeTraits: Trait[];
  evidence: Evidence[];
}

export interface CorrectionResult {
  supersededTrait: Trait;
  activeTrait: Trait;
}

/**
 * Documents here use readable string `_id`s ("dana_reyes", "trait_…") rather
 * than ObjectIds, so collections are typed to match the driver's expectations.
 */
type Doc = { _id: string } & Record<string, any>;

interface TurnDoc {
  _id: string;
  speaker: "user" | "counterpart";
  text: string;
  delivery: unknown;
  timestamp: Date;
}

/** Spelled out rather than using `Doc`, so `$push` onto `turns` type-checks. */
interface SessionDoc {
  _id: string;
  counterpartId: string;
  status: string;
  turns: TurnDoc[];
  startedAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export class BackendError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

/** Frontend uses `dana-reyes`; Mongo `_id`s use `dana_reyes`. */
export function toCounterpartId(personaId: string): string {
  return personaId.replace(/-/g, "_");
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BackendError(`"${field}" is required and must be a non-empty string`, 400);
  }
  return value.trim();
}

function generateId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

/**
 * Atlas is unreachable, auth failed, or a transaction aborted. Surfaced as 503
 * so callers keep the "backend unreachable" handling they already had.
 */
function asBackendError(error: unknown): BackendError {
  if (error instanceof BackendError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new BackendError(`Database unavailable: ${message}`, 503);
}

export async function listCounterparts(): Promise<{ counterparts: CounterpartSummary[] }> {
  try {
    const db = await getDb();

    const counterparts = await db
      .collection<Doc>("counterparts")
      .find({}, { projection: { name: 1, role: 1, scenario: 1, userRole: 1 } })
      .sort({ name: 1 })
      .toArray();

    const counts = await db
      .collection<Doc>("traits")
      .aggregate([
        { $match: { status: "active" } },
        { $group: { _id: "$counterpartId", activeTraits: { $sum: 1 } } },
      ])
      .toArray();

    const byId = Object.fromEntries(counts.map((c) => [c._id, c.activeTraits]));

    return {
      counterparts: counterparts.map((c) => ({
        ...c,
        activeTraits: byId[String(c._id)] || 0,
      })) as unknown as CounterpartSummary[],
    };
  } catch (error) {
    throw asBackendError(error);
  }
}

/** Shape the data layer expects when creating a person. */
export interface CounterpartDraft {
  name: string;
  role: string;
  userRole?: string;
  scenario: string;
  wants: string;
  concessions: string[];
  boundaries: string[];
  escalation: string;
  speechRules: {
    maximumWords: number;
    fragmentsWhenTense: boolean;
    usesFiller: boolean;
  };
  /** Keyed by trait category — these become the versioned, correctable traits. */
  traits: Record<string, { claim: string; confidence: number }>;
}

export async function createCounterpart(
  draft: CounterpartDraft,
): Promise<{ counterpart: Counterpart; traits: Trait[] }> {
  const name = requireString(draft?.name, "name");
  const role = requireString(draft?.role, "role");
  const scenario = requireString(draft?.scenario, "scenario");
  const traitsInput = draft?.traits;

  if (typeof traitsInput !== "object" || traitsInput === null || Array.isArray(traitsInput)) {
    throw new BackendError('"traits" must be an object keyed by category', 400);
  }
  const traitEntries = Object.entries(traitsInput);
  if (traitEntries.length === 0) {
    throw new BackendError('"traits" must contain at least one category', 400);
  }

  try {
    const db = await getDb();
    const client = await getClient();

    // Slugify the name into a readable _id, and de-duplicate if taken.
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
    let counterpartId = base;
    for (let n = 2; await db.collection<Doc>("counterparts").findOne({ _id: counterpartId }); n++) {
      counterpartId = `${base}_${n}`;
    }

    const now = new Date();

    const counterpartDoc = {
      _id: counterpartId,
      name,
      role,
      userRole: typeof draft.userRole === "string" ? draft.userRole : null,
      scenario,
      wants: typeof draft.wants === "string" ? draft.wants : "",
      concessions: Array.isArray(draft.concessions) ? draft.concessions : [],
      boundaries: Array.isArray(draft.boundaries) ? draft.boundaries : [],
      escalation: typeof draft.escalation === "string" ? draft.escalation : "",
      speechRules: {
        maximumWords: Number(draft.speechRules?.maximumWords) || 35,
        fragmentsWhenTense: Boolean(draft.speechRules?.fragmentsWhenTense),
        usesFiller: Boolean(draft.speechRules?.usesFiller),
      },
      fictional: true,
      createdAt: now,
      updatedAt: now,
    };

    const traitDocs = traitEntries.map(([category, value]) => {
      const claim = requireString(
        typeof value === "string" ? value : value?.claim,
        `traits.${category}`,
      );
      const confidence = Number(typeof value === "object" && value ? value.confidence : undefined);
      return {
        _id: `trait_${counterpartId}_${category}_v1`,
        counterpartId,
        category: requireString(category, "trait category"),
        claim,
        confidence: Number.isFinite(confidence) ? confidence : 0.7,
        status: "active" as const,
        version: 1,
        evidenceIds: [] as string[],
        createdAt: now,
        updatedAt: now,
      };
    });

    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await db.collection<Doc>("counterparts").insertOne(counterpartDoc, { session });
        await db.collection<Doc>("traits").insertMany(traitDocs, { session });
      });
    } finally {
      await session.endSession();
    }

    return {
      counterpart: counterpartDoc as unknown as Counterpart,
      traits: traitDocs as unknown as Trait[],
    };
  } catch (error) {
    throw asBackendError(error);
  }
}

export async function getContext(counterpartId: string): Promise<CounterpartContext> {
  try {
    const db = await getDb();

    const counterpart = await db.collection<Doc>("counterparts").findOne({ _id: counterpartId });
    if (!counterpart) {
      throw new BackendError("Counterpart not found", 404);
    }

    const activeTraits = await db
      .collection<Doc>("traits")
      .find({ counterpartId, status: "active" })
      .sort({ category: 1 })
      .toArray();

    const evidenceIds = activeTraits.flatMap((trait) => trait.evidenceIds || []);

    const evidence = await db
      .collection<Doc>("evidence")
      .find({ _id: { $in: evidenceIds } })
      .toArray();

    return {
      counterpart: counterpart as unknown as Counterpart,
      activeTraits: activeTraits as unknown as Trait[],
      evidence: evidence as unknown as Evidence[],
    };
  } catch (error) {
    throw asBackendError(error);
  }
}

export async function createSession(counterpartId: string): Promise<{ _id: string }> {
  const id = requireString(counterpartId, "counterpartId");

  try {
    const db = await getDb();

    const counterpart = await db.collection<Doc>("counterparts").findOne({ _id: id });
    if (!counterpart) {
      throw new BackendError("Counterpart not found", 404);
    }

    const now = new Date();
    const session = {
      _id: generateId("session"),
      counterpartId: id,
      status: "active",
      turns: [] as TurnDoc[],
      startedAt: now,
      updatedAt: now,
    };

    await db.collection<SessionDoc>("sessions").insertOne(session);

    return session;
  } catch (error) {
    throw asBackendError(error);
  }
}

export async function logTurn(
  sessionId: string,
  speaker: "user" | "counterpart",
  text: string,
  delivery?: unknown,
): Promise<unknown> {
  if (speaker !== "user" && speaker !== "counterpart") {
    throw new BackendError('"speaker" must be one of: user, counterpart', 400);
  }
  const turnText = requireString(text, "text");

  try {
    const db = await getDb();

    const existing = await db.collection<SessionDoc>("sessions").findOne({ _id: sessionId });
    if (!existing) {
      throw new BackendError("Session not found", 404);
    }
    if (existing.status !== "active") {
      throw new BackendError("Session is not active", 400);
    }

    const now = new Date();
    const turn = {
      _id: generateId("turn"),
      speaker,
      text: turnText,
      delivery: delivery ?? null,
      timestamp: now,
    };

    const session = await db
      .collection<SessionDoc>("sessions")
      .findOneAndUpdate(
        { _id: sessionId },
        { $push: { turns: turn }, $set: { updatedAt: now } },
        { returnDocument: "after" },
      );

    return { turn, session };
  } catch (error) {
    throw asBackendError(error);
  }
}

/**
 * Supersedes the active trait in `category` with the corrected claim.
 * Runs as a transaction: evidence insert, old trait marked superseded, new
 * trait inserted at version + 1.
 */
export async function submitCorrection(
  counterpartId: string,
  category: string,
  correction: string,
): Promise<CorrectionResult> {
  const cat = requireString(category, "category");
  const claim = requireString(correction, "correction");

  try {
    const db = await getDb();
    const client = await getClient();

    const counterpart = await db.collection<Doc>("counterparts").findOne({ _id: counterpartId });
    if (!counterpart) {
      throw new BackendError("Counterpart not found", 404);
    }

    const previousTrait = await db
      .collection<Doc>("traits")
      .findOne({ counterpartId, category: cat, status: "active" });
    if (!previousTrait) {
      throw new BackendError(
        `No active trait found for counterpart "${counterpartId}" and category "${cat}"`,
        404,
      );
    }

    const now = new Date();
    const evidenceId = generateId("evidence");
    const newTraitId = generateId("trait");

    const session = client.startSession();
    let supersededTrait: unknown;
    let activeTrait: unknown;

    try {
      await session.withTransaction(async () => {
        const evidenceDoc = {
          _id: evidenceId,
          counterpartId,
          type: "user_correction",
          content: claim,
          source: "Director Interrupt",
          reliability: 0.95,
          referencesTraitId: previousTrait._id,
          createdAt: now,
        };
        await db.collection<Doc>("evidence").insertOne(evidenceDoc, { session });

        await db.collection<Doc>("traits").updateOne(
          { _id: previousTrait._id },
          { $set: { status: "superseded", supersededBy: newTraitId, updatedAt: now } },
          { session },
        );

        const newTraitDoc = {
          _id: newTraitId,
          counterpartId,
          category: cat,
          claim,
          confidence: 0.95,
          status: "active",
          version: (previousTrait.version || 1) + 1,
          evidenceIds: [evidenceId],
          supersedes: previousTrait._id,
          createdAt: now,
          updatedAt: now,
        };
        await db.collection<Doc>("traits").insertOne(newTraitDoc, { session });

        supersededTrait = {
          ...previousTrait,
          status: "superseded",
          supersededBy: newTraitId,
          updatedAt: now,
        };
        activeTrait = newTraitDoc;
      });
    } finally {
      await session.endSession();
    }

    return {
      supersededTrait: supersededTrait as Trait,
      activeTrait: activeTrait as Trait,
    };
  } catch (error) {
    throw asBackendError(error);
  }
}
