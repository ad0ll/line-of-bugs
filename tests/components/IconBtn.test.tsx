import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { IconBtn } from "@/app/components/ui/IconBtn";

describe("IconBtn", () => {
  it("renders label and hint", async () => {
    const screen = await render(
      <IconBtn label="Pause" hint="space" onClick={() => {}}>
        ⏸
      </IconBtn>,
    );
    await expect.element(screen.getByText("Pause")).toBeInTheDocument();
    await expect.element(screen.getByText("space")).toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const onClick = vi.fn();
    const screen = await render(
      <IconBtn label="Click" onClick={onClick}>
        ×
      </IconBtn>,
    );
    await screen.getByRole("button").click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies is-active class when active=true", async () => {
    const screen = await render(
      <IconBtn label="On" active onClick={() => {}}>
        ★
      </IconBtn>,
    );
    await expect.element(screen.getByRole("button")).toHaveClass("is-active");
  });

  it("respects disabled prop", async () => {
    const onClick = vi.fn();
    const screen = await render(
      <IconBtn label="No" disabled onClick={onClick}>
        ×
      </IconBtn>,
    );
    // Browser's native button-disabled semantics: the click does not
    // dispatch a click event to the handler. force: true bypasses the
    // actionability check so the locator click resolves; the handler
    // still doesn't fire because the browser drops the event.
    await screen.getByRole("button").click({ force: true });
    expect(onClick).not.toHaveBeenCalled();
  });
});
