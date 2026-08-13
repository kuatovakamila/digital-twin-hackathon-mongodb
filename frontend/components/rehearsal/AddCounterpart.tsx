"use client";

import { useState } from "react";
import type { CounterpartSummary } from "@/lib/backend";

const PLACEHOLDER = `Describe them and the situation in your own words.

e.g. My landlord's letting agent, Rhys. I'm chasing my deposit back and he
keeps claiming carpet damage that was already there. Friendly on the phone,
never puts anything in writing, goes quiet for weeks.`;

/**
 * Adds a person by describing them.
 *
 * The description goes to /api/counterparts, which resolves it into a
 * counterpart plus one trait per correctable category and stores it. Nothing
 * about a persona is hardcoded — this is the same path the seeded three took.
 */
export function AddCounterpart({ onCreated }: { onCreated: (c: CounterpartSummary) => void }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!description.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/counterparts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      onCreated(data.counterpart);
      setDescription("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that person");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="btn btn--tiny btn--add" onClick={() => setOpen(true)}>
        + Add someone
      </button>
    );
  }

  return (
    <section className="add">
      <textarea
        className="add__input"
        rows={5}
        value={description}
        placeholder={PLACEHOLDER}
        onChange={(e) => setDescription(e.target.value)}
        disabled={busy}
        autoFocus
      />
      {error && <p className="add__error">{error}</p>}
      <div className="add__actions">
        <span className="add__hint">
          Who they are, what you want from them, and how they behave when pushed.
        </span>
        <button className="btn btn--tiny" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
        <button
          className="btn btn--tiny btn--primary"
          onClick={submit}
          disabled={busy || !description.trim()}
        >
          {busy ? "Building…" : "Create"}
        </button>
      </div>
    </section>
  );
}
