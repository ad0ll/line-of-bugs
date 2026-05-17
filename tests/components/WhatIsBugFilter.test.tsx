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
        totalCount={39632}
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
        totalCount={39632}
      />,
    );
    await screen.getByRole("combobox").click();
    await expect.element(screen.getByPlaceholder(/type a bug type or species/i)).toBeInTheDocument();
  });
});
