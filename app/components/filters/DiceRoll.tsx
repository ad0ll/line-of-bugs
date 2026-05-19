"use client";
import { useState } from "react";

/**
 * Every axis is always present. Cleared axes are `[]`; rolled axes are
 * non-empty. The parent's `onRoll` wires each axis directly into its
 * setter, so every roll starts from a clean slate (filters reset) and
 * lands on the random subset.
 */
export interface DiceRollState {
  groups: string[];
  species: string[];
  views: string[];
  lifeStages: string[];
  sexes: string[];
  subjects: string[];
  insts: string[];
}

interface DiceRollProps {
  onRoll: (state: DiceRollState) => void;
  className?: string;
}

// Curated pool — the 9 most photogenic / recognizable bug types for a
// gesture-drawing student. Skipping aphids/mosquitoes/etc. that would
// land as low-info silhouettes most of the time.
// Exported for tests/components/DiceRoll.test.tsx to assert every key
// still resolves to a TAXON_GROUPS entry (W-3 — taxonomy drift guard).
export const GROUPS_POOL = [
  "butterflies",
  "moths",
  "beetles",
  "ladybugs",
  "dragonflies",
  "bees",
  "wasps",
  "mantises",
  "stick_insects",
];

// Fisher-Yates partial shuffle. `arr.sort(() => Math.random() - 0.5)`
// is the JS shuffle anti-pattern: V8's TimSort is non-uniform when the
// comparator is non-transitive, so first/last positions get biased.
// Small-array bias here is a few percentage points per element — not
// user-visible at n≤9, but the test-suite shouldn't memorialize the bug.
function pick<T>(arr: readonly T[], n: number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out.slice(0, n);
}

export function DiceRoll({ onRoll, className }: DiceRollProps) {
  const [rolling, setRolling] = useState(false);
  function roll() {
    if (rolling) return;
    setRolling(true);
    // Every axis is present. Default: cleared ([]). Apply each random
    // pick with the Phase F probabilities. Species / sexes / institutions
    // are not currently rollable axes, so they are always cleared.
    const state: DiceRollState = {
      groups: [],
      species: [],
      views: [],
      lifeStages: [],
      sexes: [],
      subjects: [],
      insts: [],
    };
    if (Math.random() < 0.6) {
      state.groups = pick(GROUPS_POOL, 1 + Math.floor(Math.random() * 3));
    }
    if (Math.random() < 0.5) {
      state.views = pick(["dorsal", "lateral", "ventral", "head"], 1);
    }
    if (Math.random() < 0.3) {
      state.lifeStages = pick(["adult", "larva", "nymph"], 1);
    }
    if (Math.random() < 0.2) {
      state.subjects = pick(["wild", "specimen", "captive"], 1);
    }
    // Apply immediately — URL updates at t=0 so facets/grid start
    // loading right away while the animation plays alongside.
    onRoll(state);
    setTimeout(() => setRolling(false), 600);
  }
  return (
    <button
      type="button"
      className={`dice-roll ${rolling ? "is-rolling" : ""} ${className ?? ""}`.trim()}
      onClick={roll}
      aria-label="roll"
      title="roll — clear and reroll filters"
    >
      <img
        src="/icons/phosphor/dice-five-duotone.svg"
        alt=""
        aria-hidden="true"
        width={18}
        height={18}
        draggable={false}
        decoding="async"
        className="dice-roll-icon"
      />
      <span className="dice-roll-label">roll</span>
      {/* 5 sparkles burst outward when .is-rolling is applied. Each
          is positioned absolutely and rotated to its angle; CSS handles
          the staggered keyframes. Render unconditionally so the
          animation has DOM nodes to animate without a remount. */}
      <span aria-hidden="true" className="dice-roll-spark dice-roll-spark--0" />
      <span aria-hidden="true" className="dice-roll-spark dice-roll-spark--1" />
      <span aria-hidden="true" className="dice-roll-spark dice-roll-spark--2" />
      <span aria-hidden="true" className="dice-roll-spark dice-roll-spark--3" />
      <span aria-hidden="true" className="dice-roll-spark dice-roll-spark--4" />
    </button>
  );
}
