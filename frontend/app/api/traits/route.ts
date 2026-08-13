import { BackendError, getContext } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The trait model, read straight from Mongo on every request.
 *
 * The browser cannot reach the Express backend (see lib/backend.ts), so this
 * is the seam the panel polls. It stays a plain read — a director correction
 * is written by /api/chat, and this route only ever reports the result.
 */

const COUNTERPART_ID = "dana_reyes";

export async function GET() {
  try {
    const { activeTraits, evidence } = await getContext(COUNTERPART_ID);

    return Response.json(
      { activeTraits, evidence },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 502;
    const message =
      err instanceof Error ? err.message : "Could not read the trait model";

    console.warn("[traits]", message);

    // Shape stays the same on failure so the panel can render an offline state
    // without special-casing the body.
    return Response.json(
      { activeTraits: [], evidence: [], error: message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
