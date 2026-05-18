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
