"use client";

import type { SessionPhase } from "@/lib/voice/useRehearsalSession";

/** Whose turn it is, at a glance — the one thing that must read on camera. */
export function MicOrb({ phase }: { phase: SessionPhase }) {
  return (
    <div className={`orb orb--${phase}`} aria-hidden>
      <span className="orb__core" />
      <span className="orb__ring" />
    </div>
  );
}
