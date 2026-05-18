import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { DiceRoll } from "@/app/components/filters/DiceRoll";

describe("DiceRoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders a button with the surprise-me aria-label", async () => {
    const screen = await render(<DiceRoll onRoll={() => {}} />);
    await expect.element(screen.getByRole("button", { name: /surprise me/i })).toBeInTheDocument();
  });

  it("calls onRoll with at least one axis when Math.random is high (all probs pass under 0.5)", async () => {
    // Math.random sequence: 0.01 (groups passes), 0.5 (one group), 0.01 (views passes), 0.1 (pick first view), ...
    // We can't fully pin without mocking, so we just verify shape: roll calls onRoll once after 500ms.
    const onRoll = vi.fn();
    vi.spyOn(Math, "random").mockReturnValue(0.05);
    const screen = await render(<DiceRoll onRoll={onRoll} />);
    await screen.getByRole("button").click();
    expect(onRoll).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onRoll).toHaveBeenCalledTimes(1);
    const arg = onRoll.mock.calls[0]![0];
    // 0.05 < 0.6, 0.5, 0.3, 0.2 — all four axes pass; each pick uses
    // additional 0.05 calls. Just confirm we got at least groups.
    expect(arg.groups?.length ?? 0).toBeGreaterThan(0);
  });

  it("does not call onRoll a second time while already rolling", async () => {
    const onRoll = vi.fn();
    vi.spyOn(Math, "random").mockReturnValue(0.99); // every axis skipped
    const screen = await render(<DiceRoll onRoll={onRoll} />);
    const btn = screen.getByRole("button");
    await btn.click();
    await btn.click(); // ignored
    vi.advanceTimersByTime(500);
    expect(onRoll).toHaveBeenCalledTimes(1);
  });

  it("adds is-rolling class during the tumble", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const screen = await render(<DiceRoll onRoll={() => {}} />);
    const btn = screen.getByRole("button");
    await btn.click();
    expect((btn.element() as HTMLElement).classList.contains("is-rolling")).toBe(true);
    vi.advanceTimersByTime(500);
  });
});
