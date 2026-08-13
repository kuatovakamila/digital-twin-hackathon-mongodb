import { NextRequest } from "next/server";
import { BackendError, getContext, toCounterpartId } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The trait model, read straight from Mongo on every request.
 *
 * The browser cannot reach the Express backend (see lib/backend.ts), so this
 * is the seam the panel polls. It stays a plain read — a director correction
 * is written by /api/chat, and this route only ever reports the result.
 */

/** Used when the picker hasn't resolved a selection yet. */
const FALLBACK_COUNTERPART_ID = "dana_reyes";

export async function GET(request: NextRequest) {
  // Ids from the picker are already Mongo `_id` slugs; normalising costs
  // nothing and keeps a hand-typed `dana-reyes` from 404ing.
  const requested = request.nextUrl.searchParams.get("counterpartId");
  const counterpartId = requested
    ? toCounterpartId(requested)
    : FALLBACK_COUNTERPART_ID;

  try {
    const { activeTraits, evidence } = await getContext(counterpartId);

    return Response.json(
      { counterpartId, activeTraits, evidence },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 502;
    const message =
      err instanceof Error ? err.message : "Could not read the trait model";

    console.warn("[traits]", counterpartId, message);

    // Shape stays the same on failure so the panel can render an offline state
    // without special-casing the body.
    return Response.json(
      { counterpartId, activeTraits: [], evidence: [], error: message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
