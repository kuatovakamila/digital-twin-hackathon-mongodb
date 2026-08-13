"use client";

import { useMemo } from "react";
import { DANA_REYES } from "@/lib/personas/dana-reyes";
import { useRehearsalSession } from "@/lib/voice/useRehearsalSession";
import { MicOrb } from "./MicOrb";
import { TestBench } from "./TestBench";
import { TraitPanel } from "./TraitPanel";
import { TranscriptFeed } from "./TranscriptFeed";

const PHASE_LABEL: Record<string, string> = {
  idle: "Not rehearsing",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  directing: "Director note — say the correction",
};

export function RehearsalStage() {
  const persona = DANA_REYES;
  // Stable for the life of the tab; the backend keys memory off this.
  const sessionId = useMemo(
    () => `s-${Math.random().toString(36).slice(2, 10)}`,
    [],
  );

  const session = useRehearsalSession({ sessionId, personaId: persona.id });
  const live = session.phase !== "idle";

  return (
    <div className="room">
      <main className="stage">
        <header className="stage__head">
          <div>
            <h1>{persona.name}</h1>
            <p className="stage__role">{persona.role}</p>
          </div>
          <div className={`stage__phase stage__phase--${session.phase}`}>
            <span className="dot" aria-hidden />
            {PHASE_LABEL[session.phase]}
          </div>
        </header>

        <p className="stage__scene">{persona.scene}</p>

        {!session.micSupported && (
          <p className="stage__error">
            This browser has no Web Speech API. Open the demo in Chrome or Edge.
          </p>
        )}
        {session.error && <p className="stage__error">{session.error}</p>}

        <TranscriptFeed
          turns={session.turns}
          interim={session.interim}
          directing={session.phase === "directing"}
        />

        <div className="stage__controls">
          <MicOrb phase={session.phase} />

          <div className="stage__buttons">
            {live ? (
              <button className="btn btn--ghost" onClick={session.end}>
                End scene
              </button>
            ) : (
              <button
                className="btn btn--primary"
                onClick={session.start}
                disabled={!session.micSupported}
              >
                Start rehearsal
              </button>
            )}

            <button
              className="btn btn--interrupt"
              onMouseDown={session.interrupt}
              onMouseUp={session.cancelInterrupt}
              disabled={!live}
              title="Hold to cut her off and give a note"
            >
              Hold D — Director interrupt
            </button>
          </div>
        </div>

        <TestBench session={session} />

        {session.lastMemoryWrite && (
          <p className="stage__memory">
            Wrote <code>{session.lastMemoryWrite.collection}</code> /{" "}
            <code>{session.lastMemoryWrite.documentId}</code>
          </p>
        )}
      </main>

      {/* The write id changes on every stored correction, which is the cue to
          refetch rather than wait out the poll. */}
      <TraitPanel refreshSignal={session.lastMemoryWrite?.documentId ?? null} />
    </div>
  );
}
