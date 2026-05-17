import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import { AllOrChipsFilter } from "@/app/components/filters/AllOrChipsFilter";

const OPTS = [
  { value: "butterflies", label: "butterflies", count: 2855 },
  { value: "beetles", label: "beetles", count: 6404 },
  { value: "moths", label: "moths", count: 3130 },
];

describe("AllOrChipsFilter empty state", () => {
  it("renders 'all X' chip when nothing selected (no inline total — audit L1)", async () => {
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
    // L1: the redundant "· 12,389" total was removed (it duplicated the
    // page-level "you have N bugs" count five times across the filter row).
    await expect.element(chip).not.toHaveTextContent("12,389");
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

describe("AllOrChipsFilter selected state", () => {
  it("renders one chip per selected value", async () => {
    const screen = await render(
      <AllOrChipsFilter
        label="bug type"
        emptyLabel="all bug types"
        options={OPTS}
        selected={["butterflies", "beetles"]}
        onChange={vi.fn()}
      />,
    );
    await expect.element(screen.getByText(/butterflies · 2,855/)).toBeInTheDocument();
    await expect.element(screen.getByText(/beetles · 6,404/)).toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: /add bug type/i })).toBeInTheDocument();
  });

  it("removing a chip calls onChange without that value", async () => {
    const onChange = vi.fn();
    const screen = await render(
      <AllOrChipsFilter
        label="bug type"
        emptyLabel="all bug types"
        options={OPTS}
        selected={["butterflies", "beetles"]}
        onChange={onChange}
      />,
    );
    await screen.getByLabelText(/remove butterflies/i).click();
    expect(onChange).toHaveBeenCalledWith(["beetles"]);
  });

  it("clicking + opens the picker", async () => {
    const screen = await render(
      <AllOrChipsFilter
        label="bug type"
        emptyLabel="all bug types"
        options={OPTS}
        selected={["butterflies"]}
        onChange={vi.fn()}
      />,
    );
    await screen.getByRole("button", { name: /add bug type/i }).click();
    await expect.element(screen.getByRole("listbox")).toBeVisible();
  });

  it("clicking option in picker calls onChange with appended value", async () => {
    const onChange = vi.fn();
    const screen = await render(
      <AllOrChipsFilter
        label="bug type"
        emptyLabel="all bug types"
        options={OPTS}
        selected={["butterflies"]}
        onChange={onChange}
      />,
    );
    await screen.getByRole("button", { name: /add bug type/i }).click();
    await screen.getByRole("option", { name: /beetles/i }).click();
    expect(onChange).toHaveBeenCalledWith(["butterflies", "beetles"]);
  });

  it("already-selected rows in picker are aria-disabled", async () => {
    const screen = await render(
      <AllOrChipsFilter
        label="bug type"
        emptyLabel="all bug types"
        options={OPTS}
        selected={["butterflies"]}
        onChange={vi.fn()}
      />,
    );
    await screen.getByRole("button", { name: /add bug type/i }).click();
    const butterfliesRow = screen.getByRole("option", { name: /butterflies/i });
    await expect.element(butterfliesRow).toHaveAttribute("aria-disabled", "true");
  });
});

describe("AllOrChipsFilter keyboard", () => {
  it("Esc closes the picker", async () => {
    const screen = await render(
      <AllOrChipsFilter
        label="bug type"
        emptyLabel="all bug types"
        options={OPTS}
        selected={[]}
        onChange={vi.fn()}
      />,
    );
    await screen.getByRole("combobox").click();
    await expect.element(screen.getByRole("listbox")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("listbox").query()).toBeNull();
  });

  it("ArrowDown moves focus through options; Enter selects", async () => {
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
    await screen.getByRole("combobox").click();
    // Search input is auto-focused. Arrow down moves into the list.
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    // Options sorted by count desc → beetles(6404), moths(3130), butterflies(2855)
    // After 2× ArrowDown, focus is on moths → Enter selects it.
    expect(onChange).toHaveBeenCalledWith(["moths"]);
  });
});
