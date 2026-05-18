import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { BugNotFoundThumb } from "@/app/components/gallery/BugNotFoundThumb";

describe("BugNotFoundThumb", () => {
  it("renders the 'bug not found' label", async () => {
    const screen = await render(<BugNotFoundThumb />);
    await expect.element(screen.getByText(/bug not found/i)).toBeInTheDocument();
  });

  it("has an aria-label for assistive tech", async () => {
    const screen = await render(<BugNotFoundThumb />);
    const root = screen.container.firstChild as HTMLElement;
    expect(root.getAttribute("aria-label")).toBe("bug not found");
  });

  it("renders the wilted flower icon", async () => {
    const screen = await render(<BugNotFoundThumb />);
    const img = screen.container.querySelector("img");
    expect(img?.getAttribute("src")).toMatch(/wilted_flower\.svg$/);
  });
});
