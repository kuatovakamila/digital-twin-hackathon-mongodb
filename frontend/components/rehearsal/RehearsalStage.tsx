"use client";

import { useEffect, useMemo, useState } from "react";
import type { CounterpartSummary } from "@/lib/backend";
import { useRehearsalSession } from "@/lib/voice/useRehearsalSession";
import { AddCounterpart } from "./AddCounterpart";
import { CounterpartPicker } from "./CounterpartPicker";
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
  const [people, setPeople] = useState<CounterpartSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/counterparts")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const list: CounterpartSummary[] = data.counterparts ?? [];
        setPeople(list);
        setSelectedId((current) => current ?? list[0]?._id ?? null);
        if (data.error) setLoadError(data.error);
      })
      .catch(() => !cancelled && setLoadError("Could not reach the backend."));
    return () => {
      cancelled = true;
    };
  }, []);

  const person = people.find((p) => p._id === selectedId) ?? null;

  // Switching person starts a new session, so memory and transcript don't bleed.
  const sessionId = useMemo(
    () => `s-${selectedId ?? "none"}-${Math.random().toString(36).slice(2, 8)}`,
    [selectedId],
  );

  const session = useRehearsalSession({
    sessionId,
    personaId: selectedId ?? "dana-reyes",
  });
  const live = session.phase !== "idle";

  return (
    <div className="room">
      <main className="stage">
        <header className="stage__head">
          <div>
            <h1>{person?.name ?? "Rehearsal Room"}</h1>
            <p className="stage__role">
              {person?.role ?? "Loading counterparts…"}
            </p>
          </div>
          <div className={`stage__phase stage__phase--${session.phase}`}>
            <span className="dot" aria-hidden />
            {PHASE_LABEL[session.phase]}
          </div>
        </header>

        <CounterpartPicker
          people={people}
          selectedId={selectedId}
          disabled={live}
          onSelect={setSelectedId}
        />

        {!live && (
          <AddCounterpart
            onCreated={(created) => {
              setPeople((prev) => [...prev, created]);
              setSelectedId(created._id);
            }}
          />
        )}

        {person && (
          <p className="stage__scene">
            {person.scenario}
            {person.userRole && (
              <>
                {" "}
                <span className="stage__you">You are {person.userRole}.</span>
              </>
            )}
          </p>
        )}

        {loadError && <p className="stage__error">{loadError}</p>}
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
                disabled={!session.micSupported || !person}
              >
                Start rehearsal
              </button>
            )}

            <button
              className="btn btn--interrupt"
              onMouseDown={session.interrupt}
              onMouseUp={session.cancelInterrupt}
              disabled={!live}
              title="Hold to cut them off and give a note"
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
