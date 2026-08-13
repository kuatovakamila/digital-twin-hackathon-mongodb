/**
 * Client for the Express + MongoDB backend (backend/index.js).
 *
 * Only the Next.js route layer talks to this — never the browser. That keeps
 * one origin for the app and leaves the backend free to stay on localhost.
 */

const BASE = process.env.BACKEND_URL || "http://localhost:3001";

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

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      cache: "no-store",
    });
  } catch {
    throw new BackendError(`Backend unreachable at ${BASE}`, 503);
  }

  if (!res.ok) {
    const detail = await res.json().catch(() => ({ error: res.statusText }));
    throw new BackendError(detail.error || `Backend ${res.status}`, res.status);
  }

  return res.json() as Promise<T>;
}

export function listCounterparts(): Promise<{ counterparts: CounterpartSummary[] }> {
  return call("/api/counterparts");
}

/** Shape the backend expects when creating a person. */
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

export function createCounterpart(
  draft: CounterpartDraft,
): Promise<{ counterpart: Counterpart; traits: Trait[] }> {
  return call("/api/counterparts", {
    method: "POST",
    body: JSON.stringify(draft),
  });
}

export function getContext(counterpartId: string): Promise<CounterpartContext> {
  return call(`/api/counterparts/${counterpartId}/context`);
}

export function createSession(counterpartId: string): Promise<{ _id: string }> {
  return call("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ counterpartId }),
  });
}

export function logTurn(
  sessionId: string,
  speaker: "user" | "counterpart",
  text: string,
  delivery?: unknown,
): Promise<unknown> {
  return call(`/api/sessions/${sessionId}/turns`, {
    method: "POST",
    body: JSON.stringify({ speaker, text, delivery: delivery ?? null }),
  });
}

/**
 * Supersedes the active trait in `category` with the corrected claim.
 * The backend runs this as a transaction: evidence insert, old trait marked
 * superseded, new trait inserted at version + 1.
 */
export function submitCorrection(
  counterpartId: string,
  category: string,
  correction: string,
): Promise<CorrectionResult> {
  return call(`/api/counterparts/${counterpartId}/corrections`, {
    method: "POST",
    body: JSON.stringify({ category, correction }),
  });
}
