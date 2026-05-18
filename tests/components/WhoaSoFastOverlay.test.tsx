import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { WhoaSoFastOverlay } from "@/app/components/session/WhoaSoFastOverlay";

describe("WhoaSoFastOverlay", () => {
  it("renders nothing when visible=false", async () => {
    const screen = await render(<WhoaSoFastOverlay visible={false} />);
    expect(screen.container.querySelector(".session-whoa")).toBeNull();
  });

  it("renders the 'whoa so fast' text (no exclamation point) when visible", async () => {
    const screen = await render(<WhoaSoFastOverlay visible />);
    await expect.element(screen.getByText("whoa so fast")).toBeInTheDocument();
    // Sanity: no exclamation mark — the copy is intentionally muted.
    expect(screen.container.textContent).not.toContain("!");
  });

  it("renders the spinny cherry-blossom icon", async () => {
    const screen = await render(<WhoaSoFastOverlay visible />);
    const flower = screen.container.querySelector(".session-whoa-flower");
    expect(flower).not.toBeNull();
  });
});
