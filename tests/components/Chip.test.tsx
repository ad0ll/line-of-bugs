import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Chip } from "@/app/components/ui/Chip";

describe("Chip", () => {
  it("renders label", () => {
    render(<Chip label="butterflies" active={false} tooltip={null} onClick={() => {}} />);
    expect(screen.getByText("butterflies")).toBeInTheDocument();
  });

  it("renders count when provided", () => {
    render(<Chip label="moths" count={3204} active={false} tooltip={null} onClick={() => {}} />);
    expect(screen.getByText("3,204")).toBeInTheDocument();
  });

  it("collapses to single number when count === total", () => {
    render(<Chip label="x" count={42} total={42} active={false} tooltip={null} onClick={() => {}} />);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.queryByText(/\/.*42/)).not.toBeInTheDocument();
  });

  it("renders 'filtered / total' when count !== total", () => {
    render(<Chip label="x" count={12} total={4432} active={false} tooltip={null} onClick={() => {}} />);
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText(/4,432/)).toBeInTheDocument();
  });

  it("applies chip-active class when active=true", () => {
    render(<Chip label="x" active={true} tooltip={null} onClick={() => {}} />);
    expect(screen.getByRole("button").className).toContain("chip-active");
  });

  it("applies chip-disabled class when disabled=true", () => {
    render(<Chip label="x" active={false} disabled tooltip={null} onClick={() => {}} />);
    expect(screen.getByRole("button").className).toContain("chip-disabled");
  });

  it("wires onClick", () => {
    let clicked = false;
    render(<Chip label="x" active={false} tooltip={null} onClick={() => { clicked = true; }} />);
    fireEvent.click(screen.getByRole("button"));
    expect(clicked).toBe(true);
  });

  it("wraps in a tooltip-aware container when tooltip is provided", () => {
    const { container } = render(
      <Chip label="x" active={false} tooltip="hello" onClick={() => {}} />,
    );
    expect(container.querySelector(".tooltip-wrap")).toBeInTheDocument();
  });

  it("does NOT wrap in a tooltip container when tooltip is null", () => {
    const { container } = render(
      <Chip label="x" active={false} tooltip={null} onClick={() => {}} />,
    );
    expect(container.querySelector(".tooltip-wrap")).not.toBeInTheDocument();
  });

  it("passes through extra className for chip variants", () => {
    render(
      <Chip label="x" active={false} tooltip={null} className="taxon-group-chip" onClick={() => {}} />,
    );
    expect(screen.getByRole("button").className).toContain("taxon-group-chip");
  });
});
