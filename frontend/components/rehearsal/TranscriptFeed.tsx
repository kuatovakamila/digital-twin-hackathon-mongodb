"use client";

import { useEffect, useRef } from "react";
import type { Turn } from "@/lib/voice/types";

interface Props {
  turns: Turn[];
  interim: string;
  directing: boolean;
}

const SPEAKER: Record<Turn["role"], string> = {
  user: "You",
  persona: "Dana",
  director: "Director note",
  system: "",
};

export function TranscriptFeed({ turns, interim, directing }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, interim]);

  return (
    <div className="feed" role="log" aria-live="polite">
      {turns.length === 0 && !interim && (
        <p className="feed__empty">
          Start the rehearsal and open with your pitch. Hold <kbd>D</kbd> at any
          point to cut her off and correct how she plays it.
        </p>
      )}

      {turns.map((turn) => (
        <article key={turn.id} className={`turn turn--${turn.role}`}>
          <div className="turn__meta">
            <span className="turn__speaker">{SPEAKER[turn.role]}</span>
            {turn.delivery && (
              <span className="turn__delivery">
                {turn.delivery.pace} · {turn.delivery.energy} ·{" "}
                {turn.delivery.manner}
              </span>
            )}
            {turn.retake && <span className="turn__retake">retake</span>}
          </div>
          <p className="turn__text">{turn.text}</p>
        </article>
      ))}

      {interim && (
        <article className={`turn turn--interim ${directing ? "turn--directing" : ""}`}>
          <div className="turn__meta">
            <span className="turn__speaker">
              {directing ? "Director note" : "You"}
            </span>
          </div>
          <p className="turn__text">{interim}</p>
        </article>
      )}

      <div ref={endRef} />
    </div>
  );
}
