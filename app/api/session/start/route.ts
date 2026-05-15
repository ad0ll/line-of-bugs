import { randomUUID } from "node:crypto";
import { buildSessionPool } from "@/lib/queries/session";
import { setPool } from "@/lib/session-pools";

const SUBJECT_TYPES = new Set(["nature", "specimen", "both"]);
const REPEAT_MODES = new Set(["default", "never-repeat-animals", "allow-different-angles"]);

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const intervalSec = Number(b.intervalSec);
  const subjectType = String(b.subjectType ?? "");
  const repeatMode = String(b.repeatMode ?? "");

  if (!Number.isFinite(intervalSec) || intervalSec < 10 || intervalSec > 3600) {
    return new Response("invalid intervalSec", { status: 400 });
  }
  if (!SUBJECT_TYPES.has(subjectType)) {
    return new Response("invalid subjectType", { status: 400 });
  }
  if (!REPEAT_MODES.has(repeatMode)) {
    return new Response("invalid repeatMode", { status: 400 });
  }

  const items = await buildSessionPool({
    subjectType: subjectType as "nature" | "specimen" | "both",
    repeatMode: repeatMode as "default" | "never-repeat-animals" | "allow-different-angles",
  });

  if (items.length === 0) {
    return new Response("no eligible images for these filters", { status: 422 });
  }

  const sessionId = randomUUID();
  setPool(sessionId, items);

  return Response.json({ sessionId, count: items.length });
}
