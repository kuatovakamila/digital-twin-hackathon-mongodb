"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Evidence, Trait } from "@/lib/backend";

/**
 * What the system currently believes about the counterpart.
 *
 * This is the memory made visible: it polls the trait model and animates the
 * delta rather than redrawing. A director correction supersedes a trait inside
 * its category, so the outgoing and incoming cards share a slot and the change
 * reads as a revision, not as one card leaving and an unrelated one arriving.
 */

const POLL_MS = 2000;
/** Long enough to read the strikethrough before it goes. */
const EXIT_MS = 600;
const GLOW_MS = 2000;

interface TraitsResponse {
  counterpartId: string;
  activeTraits: Trait[];
  evidence: Evidence[];
  error?: string;
}

interface TraitPanelProps {
  /** Whose model to show. Null while the picker is still resolving. */
  counterpartId?: string | null;
  /** Changes when a correction is written, which forces an immediate refetch. */
  refreshSignal?: string | null;
}

type SlotPhase = "live" | "exiting" | "entering";

interface Slot {
  /** Stable across a revision — this is what makes it one slot, not two. */
  key: string;
  trait: Trait;
  phase: SlotPhase;
  /** Held back until the outgoing card in this slot has faded. */
  incoming?: Trait;
}

interface Reconciled {
  slots: Slot[];
  /** Slots whose held `incoming` should be revealed once the exit finishes. */
  reveals: string[];
  /** Slots that go away with nothing replacing them. */
  drops: string[];
  /** Freshly arrived slots that need to stop glowing. */
  settles: string[];
}

function reconcile(prev: Slot[], next: Trait[], firstLoad: boolean): Reconciled {
  const nextById = new Map(next.map((trait) => [trait._id, trait]));
  const claimed = new Set<string>();

  const slots: Slot[] = [];
  const reveals: string[] = [];
  const drops: string[] = [];
  const settles: string[] = [];

  for (const slot of prev) {
    // Mid-animation. Its own timer owns it; touching it here would restart it.
    if (slot.phase === "exiting") {
      slots.push(slot);
      if (slot.incoming) claimed.add(slot.incoming._id);
      continue;
    }

    const current = nextById.get(slot.trait._id);
    if (current) {
      claimed.add(current._id);
      // Confidence and version can move without the id changing.
      slots.push({ ...slot, trait: current });
      continue;
    }

    // Gone from the active set. If something supersedes it, the two share this
    // slot; otherwise the slot simply empties.
    const replacement = next.find(
      (trait) => trait.supersedes === slot.trait._id && !claimed.has(trait._id),
    );

    if (replacement) {
      claimed.add(replacement._id);
      slots.push({ ...slot, phase: "exiting", incoming: replacement });
      reveals.push(slot.key);
    } else {
      slots.push({ ...slot, phase: "exiting", incoming: undefined });
      drops.push(slot.key);
    }
  }

  for (const trait of next) {
    if (claimed.has(trait._id)) continue;
    // The initial paint is not a change; only arrivals after it glow.
    const phase: SlotPhase = firstLoad ? "live" : "entering";
    slots.push({ key: trait._id, trait, phase });
    if (!firstLoad) settles.push(trait._id);
  }

  return { slots, reveals, drops, settles };
}

export function TraitPanel({ counterpartId, refreshSignal }: TraitPanelProps) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Timers mutate slots from outside React's flow, so the ref is the source of
  // truth and state only mirrors it.
  const slotsRef = useRef<Slot[]>([]);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const inFlight = useRef(false);
  const firstLoad = useRef(true);
  const alive = useRef(true);
  /** Whose model the panel is currently showing, for discarding stale replies. */
  const showing = useRef<string | null>(counterpartId ?? null);
  const pendingFetch = useRef<AbortController | null>(null);

  const commit = useCallback((update: (current: Slot[]) => Slot[]) => {
    if (!alive.current) return;
    slotsRef.current = update(slotsRef.current);
    setSlots(slotsRef.current);
  }, []);

  const later = useCallback((ms: number, run: () => void) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      run();
    }, ms);
    timers.current.add(id);
  }, []);

  const settle = useCallback(
    (key: string) => {
      later(GLOW_MS, () =>
        commit((current) =>
          current.map((slot) =>
            slot.key === key && slot.phase === "entering"
              ? { ...slot, phase: "live" }
              : slot,
          ),
        ),
      );
    },
    [commit, later],
  );

  const apply = useCallback(
    (traits: Trait[]) => {
      const result = reconcile(slotsRef.current, traits, firstLoad.current);
      firstLoad.current = false;

      commit(() => result.slots);

      for (const key of result.drops) {
        later(EXIT_MS, () =>
          commit((current) => current.filter((slot) => slot.key !== key)),
        );
      }

      for (const key of result.reveals) {
        later(EXIT_MS, () => {
          commit((current) =>
            current.map((slot) =>
              slot.key === key && slot.incoming
                ? { key: slot.key, trait: slot.incoming, phase: "entering" }
                : slot,
            ),
          );
          settle(key);
        });
      }

      for (const key of result.settles) settle(key);
    },
    [commit, later, settle],
  );

  const load = useCallback(async () => {
    if (!counterpartId) return;
    // A slow backend must not stack requests behind a 2s poll.
    if (inFlight.current) return;
    inFlight.current = true;

    const controller = new AbortController();
    pendingFetch.current = controller;

    try {
      const res = await fetch(
        `/api/traits?counterpartId=${encodeURIComponent(counterpartId)}`,
        { cache: "no-store", signal: controller.signal },
      );
      const data = (await res.json()) as TraitsResponse;
      if (!alive.current) return;
      // Switching person mid-request would otherwise paint the old model over
      // the new one, and the diff would read it as a wholesale correction.
      if (showing.current !== counterpartId) return;

      if (!res.ok) throw new Error(data.error || `Trait model unavailable (${res.status})`);

      apply(data.activeTraits ?? []);
      setError(null);
      setLoaded(true);
    } catch (err) {
      if (!alive.current || showing.current !== counterpartId) return;
      // Keep the last known model on screen. A blank panel mid-demo reads as a
      // broken product; a stale one with a warning reads as an offline backend.
      setError(err instanceof Error ? err.message : "Trait model unavailable");
    } finally {
      // A request abandoned by a person-switch must not release the guard the
      // switch's own request is already holding.
      if (showing.current === counterpartId) inFlight.current = false;
      if (pendingFetch.current === controller) pendingFetch.current = null;
    }
  }, [apply, counterpartId]);

  useEffect(() => {
    alive.current = true;

    // A different person is a different model, not a revision of this one, so
    // the old cards are dropped outright rather than animated as supersessions.
    showing.current = counterpartId ?? null;
    pendingFetch.current?.abort();
    pendingFetch.current = null;
    inFlight.current = false;
    for (const id of timers.current) clearTimeout(id);
    timers.current.clear();
    slotsRef.current = [];
    setSlots([]);
    setError(null);
    setLoaded(false);
    firstLoad.current = true;

    if (!counterpartId) return;

    void load();

    const poll = setInterval(() => void load(), POLL_MS);
    const pending = timers.current;

    return () => {
      alive.current = false;
      clearInterval(poll);
      pendingFetch.current?.abort();
      for (const id of pending) clearTimeout(id);
      pending.clear();
    };
  }, [counterpartId, load]);

  // A correction has landed in Mongo. Waiting up to 2s to show it would put the
  // panel behind the retake the user is already hearing.
  const seenSignal = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal === seenSignal.current) return;
    seenSignal.current = refreshSignal;
    if (refreshSignal) void load();
  }, [refreshSignal, load]);

  const active = slots.filter((slot) => slot.phase !== "exiting").length;

  return (
    <aside className="traits">
      <header className="traits__head">
        <h2 className="traits__title">Trait Model</h2>
        <span className="traits__count" title="Active traits">
          {!counterpartId || !loaded ? "—" : active}
        </span>
      </header>

      {error && <p className="traits__error">{error}</p>}

      <div className="traits__list" aria-live="polite">
        {!counterpartId && (
          <p className="traits__empty">
            Select a counterpart to see what the system believes about them.
          </p>
        )}

        {counterpartId && loaded && slots.length === 0 && !error && (
          <p className="traits__empty">
            No traits recorded for this counterpart yet.
          </p>
        )}

        {slots.map((slot) => (
          <TraitCard key={slot.key} slot={slot} />
        ))}
      </div>

      <p className="traits__foot">
        Live from MongoDB. Corrections supersede a trait in place.
      </p>
    </aside>
  );
}

function TraitCard({ slot }: { slot: Slot }) {
  const { trait, phase } = slot;
  const pct = Math.round(Math.max(0, Math.min(1, trait.confidence)) * 100);

  return (
    <article className={`trait trait--${phase}`}>
      <div className="trait__head">
        <span className="trait__label">
          {trait.supersedes && (
            <span className="trait__revised" role="img" aria-label="Revised" />
          )}
          {trait.category.replace(/_/g, " ")}
        </span>
        <span className="trait__meta">
          <span className="trait__value">{trait.confidence.toFixed(2)}</span>
          <span className="trait__version">v{trait.version}</span>
        </span>
      </div>

      {/* The inner span is what the strikethrough draws across — a background
          gradient on an inline box, so it strikes every wrapped line. */}
      <p className="trait__claim">
        <span>{trait.claim}</span>
      </p>

      <div
        className="trait__rail"
        role="img"
        aria-label={`Confidence ${pct} percent`}
      >
        <span className="trait__fill" style={{ width: `${pct}%` }} />
      </div>
    </article>
  );
}
