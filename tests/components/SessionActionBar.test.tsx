import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { SessionActionBar } from "@/app/components/session/SessionActionBar";

const noop = () => {};

const baseProps = {
  visible: true,
  paused: false,
  bw: false,
  magnifier: "off" as const,
  isFullscreen: false,
  currentIdx: 0,
  total: 47,
  intervalSec: 60,
  sourceImageUrl: "https://example.com/img.jpg",
  onPause: noop,
  onToggleBw: noop,
  onMagnifier: noop,
  onToggleFullscreen: noop,
  onReport: noop,
  onIntervalChange: noop,
};

describe("SessionActionBar", () => {
  it("renders the in-bar buttons and counter", async () => {
    const screen = await render(<SessionActionBar {...baseProps} />);
    await expect.element(screen.getByText(/pause/i)).toBeInTheDocument();
    await expect.element(screen.getByText(/b\.w/i)).toBeInTheDocument();
    await expect.element(screen.getByText(/magnifier/i)).toBeInTheDocument();
    await expect.element(screen.getByText(/fullscreen/i)).toBeInTheDocument();
    await expect.element(screen.getByText(/report/i)).toBeInTheDocument();
    await expect.element(screen.getByText(/source/i)).toBeInTheDocument();
    // Counter now splits "1 of 47" across three spans.
    const counter = screen.container.querySelector(".session-counter");
    expect(counter?.textContent).toMatch(/1\s*of\s*47/);
  });

  it("calls onPause when pause button clicked", async () => {
    const onPause = vi.fn();
    const screen = await render(<SessionActionBar {...baseProps} total={1} onPause={onPause} />);
    // Locator with name filter — picks the pause button specifically.
    await screen.getByRole("button", { name: /pause/i }).click();
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it("hides via opacity when visible=false", async () => {
    const screen = await render(<SessionActionBar {...baseProps} visible={false} />);
    const root = screen.container.firstChild as HTMLElement;
    expect(root.style.opacity).toBe("0");
  });
});
