import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { DiceRoll, GROUPS_POOL } from "@/app/components/filters/DiceRoll";
import { TAXON_GROUPS } from "@/lib/taxonomy";

describe("DiceRoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders a button with the roll aria-label", async () => {
    const screen = await render(<DiceRoll onRoll={() => {}} />);
    await expect.element(screen.getByRole("button", { name: /^roll$/i })).toBeInTheDocument();
  });

  it("renders a dice icon (img) inside the button", async () => {
    const screen = await render(<DiceRoll onRoll={() => {}} />);
    const btn = screen.getByRole("button");
    const img = (btn.element() as HTMLElement).querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("/icons/phosphor/dice-five-duotone.svg");
  });

  it("renders 5 sparkle span children for the burst animation", async () => {
    const screen = await render(<DiceRoll onRoll={() => {}} />);
    const btn = screen.getByRole("button");
    const sparks = (btn.element() as HTMLElement).querySelectorAll(".dice-roll-spark");
    expect(sparks.length).toBe(5);
  });

  it("invokes onRoll immediately with a clear-then-roll state shape", async () => {
    const onRoll = vi.fn();
    vi.spyOn(Math, "random").mockReturnValue(0.05);
    const screen = await render(<DiceRoll onRoll={onRoll} />);
    await screen.getByRole("button").click();
    // onRoll fires synchronously; no 500ms gate.
    expect(onRoll).toHaveBeenCalledTimes(1);
    const arg = onRoll.mock.calls[0]![0];
    // Every axis is present — cleared axes are [], rolled axes are non-empty.
    expect(arg).toHaveProperty("groups");
    expect(arg).toHaveProperty("species");
    expect(arg).toHaveProperty("views");
    expect(arg).toHaveProperty("lifeStages");
    expect(arg).toHaveProperty("sexes");
    expect(arg).toHaveProperty("subjects");
    expect(arg).toHaveProperty("insts");
    // species / sexes / insts are always cleared.
    expect(arg.species).toEqual([]);
    expect(arg.sexes).toEqual([]);
    expect(arg.insts).toEqual([]);
    // With Math.random = 0.05, all rollable axes are populated.
    expect(arg.groups.length).toBeGreaterThan(0);
    expect(arg.views.length).toBe(1);
    expect(arg.lifeStages.length).toBe(1);
    expect(arg.subjects.length).toBe(1);
  });

  it("with Math.random=0.99 every rollable axis is empty (just a clear)", async () => {
    const onRoll = vi.fn();
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const screen = await render(<DiceRoll onRoll={onRoll} />);
    await screen.getByRole("button").click();
    expect(onRoll).toHaveBeenCalledTimes(1);
    const arg = onRoll.mock.calls[0]![0];
    expect(arg.groups).toEqual([]);
    expect(arg.views).toEqual([]);
    expect(arg.lifeStages).toEqual([]);
    expect(arg.subjects).toEqual([]);
  });

  it("ignores a second click while .is-rolling is active", async () => {
    const onRoll = vi.fn();
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const screen = await render(<DiceRoll onRoll={onRoll} />);
    const btn = screen.getByRole("button");
    await btn.click();   // fires onRoll once
    await btn.click();   // ignored, .is-rolling still active
    expect(onRoll).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(600);  // cleanup the is-rolling state
  });

  it("adds is-rolling class during the tumble", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const screen = await render(<DiceRoll onRoll={() => {}} />);
    const btn = screen.getByRole("button");
    await btn.click();
    expect((btn.element() as HTMLElement).classList.contains("is-rolling")).toBe(true);
    vi.advanceTimersByTime(600);
  });

  it("every GROUPS_POOL key resolves to a TAXON_GROUPS entry (W-3 drift guard)", () => {
    // If lib/taxonomy.ts renames a group key, this assertion surfaces it
    // before the dice silently rolls onto a key that no longer matches
    // any DB row. Update GROUPS_POOL in lockstep with TAXON_GROUPS keys.
    const taxonKeys = new Set(TAXON_GROUPS.map((g) => g.key));
    const orphans = GROUPS_POOL.filter((k) => !taxonKeys.has(k));
    expect(orphans).toEqual([]);
  });
});
