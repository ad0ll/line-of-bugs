import { describe, it, expect, beforeEach } from "vitest";
import { render } from "vitest-browser-react";
import { useMuted } from "@/lib/hooks/useMuted";

const KEY = "line-of-bugs:muted";

function Probe() {
  const [muted, setMuted] = useMuted();
  return (
    <div>
      <span data-testid="state">{muted ? "muted" : "unmuted"}</span>
      <button onClick={() => setMuted(!muted)}>toggle</button>
    </div>
  );
}

describe("useMuted", () => {
  beforeEach(() => {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  });

  it("defaults to unmuted when nothing is stored", async () => {
    const screen = await render(<Probe />);
    await expect.element(screen.getByTestId("state")).toHaveTextContent("unmuted");
  });

  it("restores from localStorage on mount", async () => {
    localStorage.setItem(KEY, "1");
    const screen = await render(<Probe />);
    await expect.element(screen.getByTestId("state")).toHaveTextContent("muted");
  });

  it("persists state to localStorage on update", async () => {
    const screen = await render(<Probe />);
    await screen.getByRole("button", { name: /toggle/i }).click();
    await expect.element(screen.getByTestId("state")).toHaveTextContent("muted");
    expect(localStorage.getItem(KEY)).toBe("1");
    await screen.getByRole("button", { name: /toggle/i }).click();
    expect(localStorage.getItem(KEY)).toBe("0");
  });
});
