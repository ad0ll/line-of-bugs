import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import {
  CuteFlower,
  CuteButterfly,
  CuteClock,
  CuteBug,
  CuteRefresh,
  SadBug,
} from "@/app/components/icons";

describe("cute icons", () => {
  it.each([
    ["CuteFlower", CuteFlower],
    ["CuteButterfly", CuteButterfly],
    ["CuteClock", CuteClock],
    ["CuteBug", CuteBug],
    ["CuteRefresh", CuteRefresh],
    ["SadBug", SadBug],
  ] as const)("renders %s as an SVG with aria-hidden", async (name, Cmp) => {
    const screen = await render(<Cmp size={24} data-testid={`icon-${name}`} />);
    const el = screen.getByTestId(`icon-${name}`);
    await expect.element(el).toBeInTheDocument();
    const node = el.element() as Element;
    expect(node.tagName.toLowerCase()).toBe("svg");
    expect(node.getAttribute("aria-hidden")).toBe("true");
    expect(node.getAttribute("width")).toBe("24");
  });
});
