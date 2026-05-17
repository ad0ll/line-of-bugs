import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { SocialRow } from "@/app/components/home/SocialRow";

describe("SocialRow", () => {
  it("renders four social links", async () => {
    const screen = await render(<SocialRow />);
    await expect
      .element(screen.getByRole("link", { name: /github/i }))
      .toHaveAttribute("href", expect.stringContaining("github.com"));
    await expect
      .element(screen.getByRole("link", { name: /buy me a coffee/i }))
      .toHaveAttribute("href", expect.stringContaining("buymeacoffee.com"));
    await expect
      .element(screen.getByRole("link", { name: /instagram/i }))
      .toHaveAttribute("href", expect.stringContaining("instagram.com"));
    await expect
      .element(screen.getByRole("link", { name: /bluesky/i }))
      .toHaveAttribute("href", expect.stringContaining("bsky.app"));
  });

  it("opens links in new tab", async () => {
    const screen = await render(<SocialRow />);
    const links = screen.getByRole("link").elements();
    expect(links).toHaveLength(4);
    for (const l of links) {
      expect(l.getAttribute("target")).toBe("_blank");
      expect(l.getAttribute("rel")).toMatch(/noopener/);
    }
  });
});
