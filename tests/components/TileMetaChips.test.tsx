import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { TileMetaChips } from "@/app/components/gallery/TileMetaChips";

describe("TileMetaChips", () => {
  it("renders nothing when all axes are absent", async () => {
    const screen = await render(<TileMetaChips />);
    expect(screen.container.querySelector(".grid-item-meta-chips")).toBeNull();
  });

  it("renders nothing when every value is 'unknown'", async () => {
    const screen = await render(<TileMetaChips lifeStage="unknown" sex="unknown" />);
    expect(screen.container.querySelector(".grid-item-meta-chips")).toBeNull();
  });

  it("renders chips in life-stage → sex → institution order", async () => {
    const screen = await render(
      <TileMetaChips lifeStage="larva" sex="female" institution="UGA" />,
    );
    const chips = Array.from(
      screen.container.querySelectorAll(".grid-item-meta-chip"),
    );
    expect(chips.map((c) => c.textContent)).toEqual(["larva", "female", "UGA"]);
  });

  it("institution chip carries the is-inst class for the pink tint", async () => {
    const screen = await render(<TileMetaChips institution="UGA" />);
    const chip = screen.container.querySelector(".grid-item-meta-chip");
    expect(chip?.classList.contains("is-inst")).toBe(true);
  });

  it("omits stage chip when value is null but renders sex", async () => {
    const screen = await render(<TileMetaChips lifeStage={null} sex="worker" />);
    const chips = Array.from(
      screen.container.querySelectorAll(".grid-item-meta-chip"),
    );
    expect(chips).toHaveLength(1);
    expect(chips[0]?.textContent).toBe("worker");
  });
});
