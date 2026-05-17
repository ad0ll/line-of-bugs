import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "@vitest/browser/context";
import { AllOrChipsFilter } from "@/app/components/filters/AllOrChipsFilter";

const OPTS = [
  { value: "butterflies", label: "butterflies", count: 2855 },
  { value: "beetles", label: "beetles", count: 6404 },
  { value: "moths", label: "moths", count: 3130 },
];

describe("AllOrChipsFilter empty state", () => {
  it("renders 'all X · total ⌄' chip when nothing selected", async () => {
    const onChange = vi.fn();
    const screen = await render(
      <AllOrChipsFilter
        label="bug type"
        emptyLabel="all bug types"
        options={OPTS}
        selected={[]}
        onChange={onChange}
      />,
    );
    const chip = screen.getByRole("combobox", { name: /all bug types/i });
    await expect.element(chip).toBeInTheDocument();
    await expect.element(chip).toHaveTextContent("12,389"); // 2855 + 6404 + 3130
  });

  it("clicking the empty chip opens the picker", async () => {
    const screen = await render(
      <AllOrChipsFilter
        label="bug type"
        emptyLabel="all bug types"
        options={OPTS}
        selected={[]}
        onChange={vi.fn()}
      />,
    );
    await screen.getByRole("combobox", { name: /all bug types/i }).click();
    await expect.element(screen.getByRole("listbox")).toBeVisible();
    expect(screen.getByRole("option").elements()).toHaveLength(3);
  });
});
