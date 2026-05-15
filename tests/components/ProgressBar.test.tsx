import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ProgressBar } from "@/app/components/session/ProgressBar";

describe("ProgressBar", () => {
  it("sets the fill scaleX based on percent", () => {
    const { container } = render(<ProgressBar percent={0.5} playing />);
    const fill = container.querySelector('[data-testid="progress-fill"]') as HTMLElement;
    expect(fill.style.transform).toContain("scaleX(0.5)");
  });

  it("clamps percent to [0, 1]", () => {
    const { container } = render(<ProgressBar percent={1.5} playing />);
    const fill = container.querySelector('[data-testid="progress-fill"]') as HTMLElement;
    expect(fill.style.transform).toContain("scaleX(1)");
  });

  it("removes transition when not playing", () => {
    const { container } = render(<ProgressBar percent={0.5} playing={false} />);
    const fill = container.querySelector('[data-testid="progress-fill"]') as HTMLElement;
    expect(fill.style.transition).toBe("");
  });
});
