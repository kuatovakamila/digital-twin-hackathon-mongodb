"use client";

import { useState } from "react";
import type { RehearsalSession } from "@/lib/voice/useRehearsalSession";

/**
 * Types a line or a note instead of speaking it.
 *
 * The mic is the fragile link — browser support, permissions, and Chrome's
 * silence detection all sit in front of it. This drives the identical
 * chat → voice path without any of that, so a failure here is a real failure
 * and a failure only in the spoken path is a recognition problem.
 */
export function TestBench({ session }: { session: RehearsalSession }) {
  const [text, setText] = useState("");
  const [asNote, setAsNote] = useState(false);
  const busy = session.phase === "thinking";

  const send = () => {
    if (!text.trim()) return;
    session.submit(asNote ? "note" : "line", text);
    setText("");
  };

  return (
    <section className="bench">
      <div className="bench__head">
        <span className="bench__title">Test bench</span>
        <button className="btn btn--tiny" onClick={session.testVoice}>
          Speak a test line
        </button>
      </div>

      <div className="bench__row">
        <input
          className="bench__input"
          value={text}
          placeholder={
            asNote
              ? "Director note — e.g. she'd get quieter, not sharper"
              : "Type what you'd say — e.g. I can do eighty-five thousand"
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
        />
        <button className="btn btn--tiny" onClick={send} disabled={busy || !text.trim()}>
          {busy ? "…" : "Send"}
        </button>
      </div>

      <label className="bench__toggle">
        <input
          type="checkbox"
          checked={asNote}
          onChange={(e) => setAsNote(e.target.checked)}
        />
        Send as director note (triggers a retake)
      </label>
    </section>
  );
}
