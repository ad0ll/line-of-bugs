import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { WhatIsBugFilter } from "@/app/components/filters/WhatIsBugFilter";

describe("WhatIsBugFilter empty state", () => {
  it("renders 'all bug types' chip when nothing selected", async () => {
    const screen = await render(
      <WhatIsBugFilter
        selectedGroups={[]}
        selectedSpecies={[]}
        onGroupsChange={vi.fn()}
        onSpeciesChange={vi.fn()}
      />,
    );
    const chip = screen.getByRole("combobox", { name: /all bug types/i });
    await expect.element(chip).toBeInTheDocument();
  });

  it("clicking the empty chip opens a search input", async () => {
    const screen = await render(
      <WhatIsBugFilter
        selectedGroups={[]}
        selectedSpecies={[]}
        onGroupsChange={vi.fn()}
        onSpeciesChange={vi.fn()}
      />,
    );
    await screen.getByRole("combobox").click();
    await expect.element(screen.getByPlaceholder(/type a bug type or species/i)).toBeInTheDocument();
  });
});

describe("WhatIsBugFilter picker — default candidates", () => {
  it("opens with the all-groups list pre-populated (no typing required)", async () => {
    const mockResults = [
      { kind: "group" as const, value: "butterflies", label: "butterflies", count: 12330 },
      { kind: "group" as const, value: "moths",       label: "moths",       count: 9872 },
      { kind: "group" as const, value: "beetles",     label: "beetles",     count: 7541 },
    ];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ results: mockResults }) } as Response),
    ) as typeof fetch;

    try {
      const screen = await render(
        <WhatIsBugFilter
          selectedGroups={[]}
          selectedSpecies={[]}
          onGroupsChange={vi.fn()}
          onSpeciesChange={vi.fn()}
        />,
      );
      await screen.getByRole("combobox").click();
      // The 120ms debounce + microtasks → poll up to 500ms.
      await expect.element(screen.getByText(/butterflies/i)).toBeInTheDocument();
      await expect.element(screen.getByText(/moths/i)).toBeInTheDocument();
      await expect.element(screen.getByText(/beetles/i)).toBeInTheDocument();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
