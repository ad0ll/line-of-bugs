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
  sketchfabOpen: false,
  onToggleSketchfab: noop,
  sketchfabDisabled: false,
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

  it("action bar buttons (including source) share a min-width", async () => {
    const screen = await render(<SessionActionBar {...baseProps} />);
    const buttons = screen.container.querySelectorAll(
      ".session-action-bar-panel button.u-icon-btn-stacked, .session-action-bar-panel a.u-icon-btn-stacked",
    );
    expect(buttons.length).toBeGreaterThanOrEqual(7);
    const widths = Array.from(buttons).map(
      (b) => (b as HTMLElement).getBoundingClientRect().width,
    );
    const max = Math.max(...widths);
    const min = Math.min(...widths);
    expect(max - min).toBeLessThanOrEqual(1.5); // sub-pixel rounding tolerance
  });

  it("source button is not underlined and shares the stacked layout", async () => {
    const screen = await render(<SessionActionBar {...baseProps} />);
    const source = screen.container.querySelector(
      ".session-action-bar-panel a.u-icon-btn-stacked",
    )! as HTMLElement;
    expect(source.tagName.toLowerCase()).toBe("a");
    // No underline
    const td = getComputedStyle(source).textDecorationLine;
    expect(td).toBe("none");
  });

  it("renders a Sketchfab toggle button reflecting active state", async () => {
    const onToggle = vi.fn();
    const screen = await render(
      <SessionActionBar {...baseProps} sketchfabOpen={false} onToggleSketchfab={onToggle} />,
    );
    const btn = screen.getByRole("button", { name: /sketchfab/i });
    await expect.element(btn).not.toHaveClass("is-active");
    await btn.click();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("marks the Sketchfab button active when panel is open", async () => {
    const screen = await render(
      <SessionActionBar {...baseProps} sketchfabOpen={true} onToggleSketchfab={() => {}} />,
    );
    await expect.element(screen.getByRole("button", { name: /sketchfab/i })).toHaveClass("is-active");
  });

  it("formats counter total with thousands separators", async () => {
    const screen = await render(
      <SessionActionBar {...baseProps} currentIdx={28} total={39631} />,
    );
    const counter = screen.container.querySelector(".session-counter");
    // "29 of 39,631" — locale-formatted; toLocaleString in en-US uses a comma.
    expect(counter?.textContent).toMatch(/29\s*of\s*39,631/);
  });

  it("disables the Sketchfab button when sketchfabDisabled=true", async () => {
    const onToggle = vi.fn();
    const screen = await render(
      <SessionActionBar
        {...baseProps}
        sketchfabOpen={false}
        sketchfabDisabled={true}
        onToggleSketchfab={onToggle}
      />,
    );
    const btn = screen.getByRole("button", { name: /sketchfab/i });
    await expect.element(btn).toBeDisabled();
    // force: true bypasses the actionability check so the click resolves;
    // the browser still drops the event because the button is disabled.
    await btn.click({ force: true });
    expect(onToggle).not.toHaveBeenCalled();
  });
});
