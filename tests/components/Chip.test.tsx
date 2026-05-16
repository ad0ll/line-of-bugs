import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { Chip } from "@/app/components/ui/Chip";

describe("Chip", () => {
  it("renders label", async () => {
    const screen = await render(<Chip label="butterflies" active={false} tooltip={null} onClick={() => {}} />);
    await expect.element(screen.getByText("butterflies")).toBeInTheDocument();
  });

  it("renders count when provided", async () => {
    const screen = await render(<Chip label="moths" count={3204} active={false} tooltip={null} onClick={() => {}} />);
    await expect.element(screen.getByText("3,204")).toBeInTheDocument();
  });

  it("collapses to single number when count === total", async () => {
    const screen = await render(<Chip label="x" count={42} total={42} active={false} tooltip={null} onClick={() => {}} />);
    await expect.element(screen.getByText("42")).toBeInTheDocument();
    await expect.element(screen.getByText(/\/.*42/)).not.toBeInTheDocument();
  });

  it("renders 'filtered / total' when count !== total", async () => {
    const screen = await render(<Chip label="x" count={12} total={4432} active={false} tooltip={null} onClick={() => {}} />);
    await expect.element(screen.getByText("12")).toBeInTheDocument();
    await expect.element(screen.getByText(/4,432/)).toBeInTheDocument();
  });

  it("applies chip-active class when active=true", async () => {
    const screen = await render(<Chip label="x" active={true} tooltip={null} onClick={() => {}} />);
    await expect.element(screen.getByRole("button")).toHaveClass("chip-active");
  });

  it("applies chip-disabled class when disabled=true", async () => {
    const screen = await render(<Chip label="x" active={false} disabled tooltip={null} onClick={() => {}} />);
    await expect.element(screen.getByRole("button")).toHaveClass("chip-disabled");
  });

  it("wires onClick", async () => {
    const onClick = vi.fn();
    const screen = await render(<Chip label="x" active={false} tooltip={null} onClick={onClick} />);
    await screen.getByRole("button").click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("wraps in a tooltip-aware container when tooltip is provided", async () => {
    const screen = await render(<Chip label="x" active={false} tooltip="hello" onClick={() => {}} />);
    expect(screen.container.querySelector(".tooltip-wrap")).not.toBeNull();
  });

  it("does NOT wrap in a tooltip container when tooltip is null", async () => {
    const screen = await render(<Chip label="x" active={false} tooltip={null} onClick={() => {}} />);
    expect(screen.container.querySelector(".tooltip-wrap")).toBeNull();
  });

  it("passes through extra className for chip variants", async () => {
    const screen = await render(
      <Chip label="x" active={false} tooltip={null} className="taxon-group-chip" onClick={() => {}} />,
    );
    await expect.element(screen.getByRole("button")).toHaveClass("taxon-group-chip");
  });
});
