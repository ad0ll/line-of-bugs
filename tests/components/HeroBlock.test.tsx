import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { HeroBlock } from "@/app/components/home/HeroBlock";

describe("HeroBlock", () => {
  it("renders the title with flower icon", async () => {
    const screen = await render(<HeroBlock totalCount={39605} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    await expect.element(h1).toHaveTextContent(/line of bugs/i);
  });

  it("renders the tagline with formatted count", async () => {
    const screen = await render(<HeroBlock totalCount={39605} />);
    await expect.element(screen.getByText(/39,605/)).toBeInTheDocument();
    await expect.element(screen.getByText(/insects, tenderly photographed/i)).toBeInTheDocument();
  });

  it("uses 'insect' singular when totalCount is 1", async () => {
    const screen = await render(<HeroBlock totalCount={1} />);
    await expect
      .element(screen.getByText(/1 insect, tenderly photographed/i))
      .toBeInTheDocument();
  });
});
