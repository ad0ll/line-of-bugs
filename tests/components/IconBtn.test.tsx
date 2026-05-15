import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IconBtn } from "@/app/components/ui/IconBtn";

describe("IconBtn", () => {
  it("renders label and hint", () => {
    render(
      <IconBtn label="Pause" hint="space" onClick={() => {}}>
        ⏸
      </IconBtn>,
    );
    expect(screen.getByText("Pause")).toBeInTheDocument();
    expect(screen.getByText("space")).toBeInTheDocument();
  });

  it("calls onClick when clicked", () => {
    let clicked = false;
    render(
      <IconBtn label="Click" onClick={() => { clicked = true; }}>
        ×
      </IconBtn>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(clicked).toBe(true);
  });

  it("applies is-active class when active=true", () => {
    render(
      <IconBtn label="On" active onClick={() => {}}>
        ★
      </IconBtn>,
    );
    expect(screen.getByRole("button").className).toContain("is-active");
  });

  it("respects disabled prop", () => {
    let clicked = false;
    render(
      <IconBtn label="No" disabled onClick={() => { clicked = true; }}>
        ×
      </IconBtn>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(clicked).toBe(false);
  });
});
