import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionActionBar } from "@/app/components/session/SessionActionBar";

const noop = () => {};

const baseProps = {
  visible: true,
  paused: false,
  bw: false,
  magnifier: "off" as const,
  zoom: 1,
  isFullscreen: false,
  currentIdx: 0,
  total: 47,
  intervalSec: 60,
  sourceUrl: "https://example.com",
  onPause: noop,
  onToggleBw: noop,
  onMagnifier: noop,
  onZoomIn: noop,
  onZoomOut: noop,
  onResetZoom: noop,
  onToggleFullscreen: noop,
  onReport: noop,
  onIntervalChange: noop,
};

describe("SessionActionBar", () => {
  it("renders the in-bar buttons and counter", () => {
    render(<SessionActionBar {...baseProps} />);
    expect(screen.getByText(/pause/i)).toBeInTheDocument();
    expect(screen.getByText(/b\.w/i)).toBeInTheDocument();
    expect(screen.getByText(/magnifier/i)).toBeInTheDocument();
    // Zoom cluster: three buttons (− / reset / +) with aria-labels
    expect(screen.getByLabelText(/zoom in/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/zoom out/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/reset zoom/i)).toBeInTheDocument();
    expect(screen.getByText(/fullscreen/i)).toBeInTheDocument();
    expect(screen.getByText(/report/i)).toBeInTheDocument();
    expect(screen.getByText(/source/i)).toBeInTheDocument();
    expect(screen.getByText("1 / 47")).toBeInTheDocument();
  });

  it("calls onPause when pause button clicked", () => {
    let called = false;
    render(<SessionActionBar {...baseProps} total={1} onPause={() => { called = true; }} />);
    const btns = screen.getAllByRole("button");
    fireEvent.click(btns.find((b) => /pause/i.test(b.textContent ?? ""))!);
    expect(called).toBe(true);
  });

  it("hides via opacity when visible=false", () => {
    const { container } = render(<SessionActionBar {...baseProps} visible={false} />);
    const root = container.firstChild as HTMLElement;
    expect(root.style.opacity).toBe("0");
  });
});
