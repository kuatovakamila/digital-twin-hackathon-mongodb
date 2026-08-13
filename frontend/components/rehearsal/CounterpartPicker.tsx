"use client";

import type { CounterpartSummary } from "@/lib/backend";

interface Props {
  people: CounterpartSummary[];
  selectedId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
}

/**
 * Who you're rehearsing against. Loaded from MongoDB, not hardcoded — adding a
 * person to the seed makes them appear here with no frontend change.
 */
export function CounterpartPicker({ people, selectedId, disabled, onSelect }: Props) {
  if (people.length === 0) return null;

  return (
    <div className="picker" role="radiogroup" aria-label="Choose who to rehearse against">
      {people.map((p) => {
        const active = p._id === selectedId;
        return (
          <button
            key={p._id}
            role="radio"
            aria-checked={active}
            className={`picker__card ${active ? "picker__card--active" : ""}`}
            onClick={() => onSelect(p._id)}
            disabled={disabled}
            title={disabled ? "End the scene before switching" : p.scenario}
          >
            <span className="picker__name">{p.name}</span>
            <span className="picker__role">{p.role}</span>
            <span className="picker__traits">{p.activeTraits} traits</span>
          </button>
        );
      })}
    </div>
  );
}
