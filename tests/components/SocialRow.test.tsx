import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { SocialRow } from "@/app/components/home/SocialRow";

describe("SocialRow", () => {
  it("renders three external links + one ethereum copy button", async () => {
    const screen = await render(<SocialRow />);
    await expect
      .element(screen.getByRole("link", { name: /github/i }))
      .toHaveAttribute("href", expect.stringContaining("github.com"));
    await expect
      .element(screen.getByRole("link", { name: /buy me a coffee/i }))
      .toHaveAttribute("href", expect.stringContaining("buymeacoffee.com"));
    await expect
      .element(screen.getByRole("link", { name: /bluesky/i }))
      .toHaveAttribute("href", expect.stringContaining("bsky.app"));
    // GitHub, BMC, Bluesky as links
    const links = screen.container.querySelectorAll("a.home-social-link");
    expect(links.length).toBe(3);
    // Ethereum as a button (not a link)
    const ethBtn = screen.container.querySelector("button.home-social-eth");
    expect(ethBtn).not.toBeNull();
  });

  it("opens links in new tab", async () => {
    const screen = await render(<SocialRow />);
    const links = screen.container.querySelectorAll("a.home-social-link");
    expect(links).toHaveLength(3);
    for (const l of Array.from(links)) {
      expect(l.getAttribute("target")).toBe("_blank");
      expect(l.getAttribute("rel")).toMatch(/noopener/);
    }
  });
});
