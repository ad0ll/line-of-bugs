"use client";
import { useState } from "react";

/**
 * Phase F (2026-05-17) — "surprise me" button. Picks ~2-3 filter axes at
 * random with sensible distributions. Used on both home + gallery.
 *
 * Caller wires the shape returned by `onRoll` into their own
 * setGroups / setViews / setLifeStages / setSubjects setters; the
 * absence of a key means "leave that axis alone" (don't clobber an
 * existing selection with []).
 */
export interface DiceRollState {
  groups?: string[];
  views?: string[];
  lifeStages?: string[];
  subjects?: string[];
}

interface DiceRollProps {
  onRoll: (state: DiceRollState) => void;
  className?: string;
}

// Curated pool — the 9 most photogenic / recognizable bug types for a
// gesture-drawing student. Skipping aphids/mosquitoes/etc. that would
// land as low-info silhouettes most of the time.
const GROUPS_POOL = [
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

function pick<T>(arr: readonly T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

export function DiceRoll({ onRoll, className }: DiceRollProps) {
  const [rolling, setRolling] = useState(false);
  function roll() {
    if (rolling) return;
    setRolling(true);
    const state: DiceRollState = {};
    if (Math.random() < 0.6) state.groups = pick(GROUPS_POOL, 1 + Math.floor(Math.random() * 3));
    if (Math.random() < 0.5) state.views = pick(["dorsal", "lateral", "ventral", "head"], 1);
    if (Math.random() < 0.3) state.lifeStages = pick(["adult", "larva", "nymph"], 1);
    if (Math.random() < 0.2) state.subjects = pick(["wild", "specimen", "captive"], 1);
    setTimeout(() => {
      setRolling(false);
      onRoll(state);
    }, 500);
  }
  return (
    <button
      type="button"
      className={`dice-roll ${rolling ? "is-rolling" : ""} ${className ?? ""}`.trim()}
      onClick={roll}
      aria-label="surprise me — pick random filters"
      title="surprise me"
    >
      <span aria-hidden className="dice-roll-sparkle">
        {/* Pink 4-point sparkle — fits the pastel palette where the Fluent
            dice emoji clashed (red dots + white face). Phase F adjustment. */}
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 0 L9.5 6.5 L16 8 L9.5 9.5 L8 16 L6.5 9.5 L0 8 L6.5 6.5 Z" />
        </svg>
      </span>
      <span className="dice-roll-label">surprise me</span>
    </button>
  );
}
