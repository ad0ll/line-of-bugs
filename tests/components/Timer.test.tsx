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

  it("dims when paused", async () => {
    const screen = await render(<Timer remainingMs={60_000} paused />);
    const root = screen.container.firstChild as HTMLElement;
    expect(root.style.opacity).toBe("0.55");
  });

  it("renders SR status when announcement threshold is hit (30s)", async () => {
    const screen = await render(<Timer remainingMs={30_000} paused={false} />);
    await expect.element(screen.getByRole("status")).toHaveTextContent("30 seconds remaining");
  });

  it("does not mount a status node at non-announcement seconds", async () => {
    const screen = await render(<Timer remainingMs={15_000} paused={false} />);
    await expect.element(screen.getByRole("status")).not.toBeInTheDocument();
  });
});
