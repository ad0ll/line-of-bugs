import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Timer } from "@/app/components/session/Timer";

describe("Timer", () => {
  it("formats 90 seconds as 01:30", () => {
    render(<Timer remainingMs={90_000} paused={false} />);
    expect(screen.getByText("01:30")).toBeInTheDocument();
  });

  it("formats 5 seconds as 00:05", () => {
    render(<Timer remainingMs={5_000} paused={false} />);
    expect(screen.getByText("00:05")).toBeInTheDocument();
  });

  it("formats 0 as 00:00", () => {
    render(<Timer remainingMs={0} paused={false} />);
    expect(screen.getByText("00:00")).toBeInTheDocument();
  });

  it("dims when paused", () => {
    const { container } = render(<Timer remainingMs={60_000} paused />);
    const root = container.firstChild as HTMLElement;
    expect(root.style.opacity).toBe("0.55");
  });
});
