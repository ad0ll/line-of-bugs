import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { Timer } from "@/app/components/session/Timer";

describe("Timer", () => {
  it("formats 90 seconds as 01:30", async () => {
    const screen = await render(<Timer remainingMs={90_000} paused={false} />);
    await expect.element(screen.getByText("01:30")).toBeInTheDocument();
  });

  it("formats 5 seconds as 00:05", async () => {
    const screen = await render(<Timer remainingMs={5_000} paused={false} />);
    await expect.element(screen.getByText("00:05")).toBeInTheDocument();
  });

  it("formats 0 as 00:00", async () => {
    const screen = await render(<Timer remainingMs={0} paused={false} />);
    await expect.element(screen.getByText("00:00")).toBeInTheDocument();
  });

  it("adds .is-paused class to the pill when paused (bolder treatment, no overlay)", async () => {
    const screen = await render(<Timer remainingMs={60_000} paused />);
    const root = screen.container.firstChild as HTMLElement;
    expect(root.classList.contains("is-paused")).toBe(true);
  });

  it("renders ⏸ glyph + 'paused' label instead of the time when paused", async () => {
    const screen = await render(<Timer remainingMs={60_000} paused />);
    const glyph = screen.container.querySelector(".session-timer-paused-glyph");
    const label = screen.container.querySelector(".session-timer-paused-label");
    expect(glyph?.textContent).toBe("⏸");
    expect(label?.textContent).toBe("paused");
    // Time string should NOT be displayed while paused — pill is wholly
    // the pause indicator.
    expect(screen.container.textContent).not.toMatch(/\d\d:\d\d/);
  });

  it("omits the pause glyph + label when not paused", async () => {
    const screen = await render(<Timer remainingMs={60_000} paused={false} />);
    expect(screen.container.querySelector(".session-timer-paused-glyph")).toBeNull();
    expect(screen.container.querySelector(".session-timer-paused-label")).toBeNull();
  });

  it("renders SR status when announcement threshold is hit (30s)", async () => {
    const screen = await render(<Timer remainingMs={30_000} paused={false} />);
    await expect.element(screen.getByRole("status")).toHaveTextContent("30 seconds remaining");
  });

  it("does not mount a status node at non-announcement seconds", async () => {
    const screen = await render(<Timer remainingMs={15_000} paused={false} />);
    await expect.element(screen.getByRole("status")).not.toBeInTheDocument();
  });

  it("appends a muted icon when muted=true", async () => {
    const screen = await render(<Timer remainingMs={60_000} paused={false} muted />);
    const icon = screen.container.querySelector(".session-timer-muted-icon");
    expect(icon?.textContent).toBe("⊘");
  });

  it("omits the muted icon when muted is false", async () => {
    const screen = await render(<Timer remainingMs={60_000} paused={false} />);
    expect(screen.container.querySelector(".session-timer-muted-icon")).toBeNull();
  });
});
