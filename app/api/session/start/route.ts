import { randomUUID } from "node:crypto";
import { buildSessionPool } from "@/lib/queries/session";
import { setPool } from "@/lib/session-pools";
import { parseSubjectStrict } from "@/lib/subject";

const REPEAT_MODES = new Set(["default", "never-repeat-animals", "allow-different-angles"]);

function readList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v) return v.split(",").filter(Boolean);
  return [];
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const intervalSec = Number(b.intervalSec);
  const subjectRaw = String(b.subjectType ?? "");
  const repeatMode = String(b.repeatMode ?? "");

  if (!Number.isFinite(intervalSec) || intervalSec < 10 || intervalSec > 3600) {
    return new Response("invalid intervalSec", { status: 400 });
  }
  // parseSubjectStrict accepts wild/captive/specimen/all + the two
  // legacy aliases (nature→wild, both→all); anything else 400s.
  const subjectType = parseSubjectStrict(subjectRaw);
  if (subjectType === null) {
    return new Response("invalid subjectType", { status: 400 });
  }
  if (!REPEAT_MODES.has(repeatMode)) {
    return new Response("invalid repeatMode", { status: 400 });
  }

  const items = await buildSessionPool({
    subjectType,
    repeatMode: repeatMode as "default" | "never-repeat-animals" | "allow-different-angles",
    views: readList(b.views),
    lifeStages: readList(b.lifeStages),
    sexes: readList(b.sexes),
    groups: readList(b.groups),
  });

  if (items.length === 0) {
    return new Response("no eligible images for these filters", { status: 422 });
  }

  const sessionId = randomUUID();
  if (!setPool(sessionId, items)) {
    return new Response("server busy — retry shortly", { status: 503 });
  }

  return Response.json({ sessionId, count: items.length });
}
