"use client";

import { useState } from "react";

const INITIAL_TRAITS = [
  { id: "t1", claim: "says he'll look into it, never follows up", dimension: "conflict_style", confidence: 0.8 },
  { id: "t2", claim: "gets short when repair costs come up", dimension: "triggers", confidence: 0.7 },
  { id: "t3", claim: "argues back when challenged on rent", dimension: "conflict_style", confidence: 0.6 },
  { id: "t4", claim: "brings up how long he's owned the building", dimension: "speech_pattern", confidence: 0.5 },
  { id: "t5", claim: "concedes on small repairs to avoid bigger asks", dimension: "concessions", confidence: 0.65 },
  { id: "t6", claim: "never gives a straight yes or no", dimension: "conflict_style", confidence: 0.75 },
];

const CORRECTED_TRAIT = {
  id: "t3-corrected",
  claim: "goes quiet and stalls when challenged on rent",
  dimension: "conflict_style",
  confidence: 0.6,
};

const TRANSCRIPT = [
  { speaker: "You", text: "The radiator in the back bedroom hasn't worked since November. I've mentioned it three times." },
  { speaker: "Robert (landlord)", text: "I hear you. Let me look into it and get back to you this week." },
  { speaker: "You", text: "That's what you said in December. I'd like a date for the repair." },
  { speaker: "Robert (landlord)", text: "These things take time. I've owned this building for twenty-two years, I know how the heating runs." },
  { speaker: "You", text: "Then you know it should have been fixed by now. And I don't think a rent increase makes sense while it's broken." },
  { speaker: "Robert (landlord)", text: "The increase is separate. I'll see what I can do about the radiator." },
];

const FADE_MS = 600;
const GLOW_MS = 2000;

export default function Home() {
  const [traits, setTraits] = useState(INITIAL_TRAITS);
  const [retractingId, setRetractingId] = useState(null);
  const [glowingId, setGlowingId] = useState(null);
  const [corrected, setCorrected] = useState(false);

  function simulateCorrection() {
    if (corrected || retractingId) return;
    setCorrected(true);
    setRetractingId("t3");

    setTimeout(() => {
      setTraits((prev) => prev.map((t) => (t.id === "t3" ? CORRECTED_TRAIT : t)));
      setRetractingId(null);
      setGlowingId(CORRECTED_TRAIT.id);
      setTimeout(() => setGlowingId(null), GLOW_MS);
    }, FADE_MS);
  }

  return (
    <main className="page">
      <section className="transcript">
        <header className="pane-head">
          <h1>Conversation</h1>
          <p className="sub">Robert (landlord) &middot; unit 4B</p>
        </header>
        <div className="messages">
          {TRANSCRIPT.map((m, i) => (
            <div key={i} className={m.speaker === "You" ? "msg msg-you" : "msg msg-them"}>
              <div className="speaker">{m.speaker}</div>
              <p className="bubble">{m.text}</p>
            </div>
          ))}
        </div>
      </section>

      <aside className="panel">
        <header className="pane-head">
          <h2>Trait Model</h2>
          <p className="sub">{traits.length} observed traits</p>
        </header>

        <div className="cards">
          {traits.map((t) => {
            const retracting = t.id === retractingId;
            const glowing = t.id === glowingId;
            return (
              <article
                key={t.id}
                className={`card${retracting ? " retracting" : ""}${glowing ? " glowing" : ""}${
                  t.id === CORRECTED_TRAIT.id ? " entering" : ""
                }`}
              >
                <div className="dimension">{t.dimension}</div>
                <p className="claim">{t.claim}</p>
                <div className="bar">
                  <div className="fill" style={{ width: `${t.confidence * 100}%` }} />
                </div>
                <div className="value">{t.confidence.toFixed(2)}</div>
              </article>
            );
          })}
        </div>

        <button className="correct" onClick={simulateCorrection} disabled={corrected}>
          simulate correction
        </button>
      </aside>

      <style jsx>{`
        .page {
          display: grid;
          grid-template-columns: 2fr 1fr;
          min-height: 100vh;
          background: #0b0b0d;
          color: #e8e8ea;
        }

        .transcript {
          padding: 56px 56px 72px;
          border-right: 1px solid #1e1e22;
        }

        .panel {
          padding: 56px 40px 72px;
          display: flex;
          flex-direction: column;
          background: #0e0e11;
        }

        .pane-head {
          margin-bottom: 40px;
        }

        h1,
        h2 {
          font-size: 15px;
          font-weight: 500;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #f2f2f4;
          margin: 0;
        }

        .sub {
          margin: 8px 0 0;
          font-size: 13px;
          color: #6b6b73;
        }

        .messages {
          display: flex;
          flex-direction: column;
          gap: 28px;
          max-width: 640px;
        }

        .msg {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .msg-you {
          align-items: flex-end;
          text-align: right;
        }

        .speaker {
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #6b6b73;
        }

        .bubble {
          margin: 0;
          font-size: 15px;
          line-height: 1.65;
          max-width: 82%;
          padding: 14px 18px;
          border-radius: 4px;
          border: 1px solid #1e1e22;
          color: #d2d2d8;
        }

        .msg-you .bubble {
          background: #16161a;
          color: #eaeaef;
        }

        .msg-them .bubble {
          background: transparent;
        }

        .cards {
          display: flex;
          flex-direction: column;
          gap: 14px;
          flex: 1;
        }

        .card {
          border: 1px solid #1e1e22;
          border-radius: 4px;
          padding: 16px 18px;
          background: #121216;
        }

        .dimension {
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #6b6b73;
        }

        .claim {
          margin: 10px 0 14px;
          font-size: 14px;
          line-height: 1.5;
          color: #dcdce2;
        }

        .bar {
          height: 3px;
          background: #232329;
          border-radius: 2px;
          overflow: hidden;
        }

        .fill {
          height: 100%;
          background: #8a8aa0;
          transition: width 400ms ease;
        }

        .value {
          margin-top: 8px;
          font-size: 11px;
          color: #57575f;
          font-variant-numeric: tabular-nums;
        }

        .retracting {
          animation: retract ${FADE_MS}ms ease forwards;
        }

        .retracting .claim {
          text-decoration: line-through;
          color: #7a7a82;
        }

        .entering {
          animation: slide-in 420ms cubic-bezier(0.22, 1, 0.36, 1);
        }

        .glowing {
          animation: slide-in 420ms cubic-bezier(0.22, 1, 0.36, 1),
            glow ${GLOW_MS}ms ease-out;
        }

        @keyframes retract {
          0% {
            opacity: 1;
          }
          20% {
            opacity: 1;
          }
          100% {
            opacity: 0;
          }
        }

        @keyframes slide-in {
          from {
            opacity: 0;
            transform: translateX(36px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes glow {
          0% {
            border-color: #6e6ea8;
            box-shadow: 0 0 0 1px rgba(140, 140, 200, 0.35), 0 0 24px rgba(120, 120, 190, 0.35);
          }
          70% {
            border-color: #4a4a70;
            box-shadow: 0 0 0 1px rgba(140, 140, 200, 0.18), 0 0 16px rgba(120, 120, 190, 0.18);
          }
          100% {
            border-color: #1e1e22;
            box-shadow: none;
          }
        }

        .correct {
          margin-top: 32px;
          align-self: flex-start;
          background: transparent;
          border: 1px solid #2a2a31;
          border-radius: 3px;
          color: #b8b8c0;
          font-size: 12px;
          letter-spacing: 0.08em;
          padding: 10px 18px;
          cursor: pointer;
          transition: border-color 160ms ease, color 160ms ease;
        }

        .correct:hover:not(:disabled) {
          border-color: #45454f;
          color: #f0f0f4;
        }

        .correct:disabled {
          opacity: 0.35;
          cursor: default;
        }

        @media (prefers-reduced-motion: reduce) {
          .retracting,
          .entering,
          .glowing {
            animation-duration: 1ms;
          }
        }
      `}</style>
    </main>
  );
}
