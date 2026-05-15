import { describe, it, expect } from "vitest";
import { POST } from "@/app/api/session/start/route";
import { getPool, _clearAll } from "@/lib/session-pools";

describe("/api/session/start", () => {
  it("returns a sessionId and stores the pool", async () => {
    _clearAll();
    const res = await POST(
      new Request("http://localhost/api/session/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intervalSec: 60,
          subjectType: "both",
          repeatMode: "default",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionId: string };
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    const pool = getPool(body.sessionId);
    expect(pool).toBeDefined();
    expect(pool!.items.length).toBeGreaterThan(0);
  });

  it("400s on invalid subjectType", async () => {
    const res = await POST(
      new Request("http://localhost/api/session/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intervalSec: 60, subjectType: "invalid", repeatMode: "default" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
