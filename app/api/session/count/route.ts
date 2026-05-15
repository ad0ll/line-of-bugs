import { countSessionPool } from "@/lib/queries/session";

const SUBJECT_TYPES = new Set(["nature", "specimen", "both"]);

function readList(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

/**
 * Live pool-size counter for the home page. Hit on every filter change so
 * the user can see how their selection narrows the dataset before starting
 * a session.
 *
 * Returns { count: number } — never throws, just clamps to 0 on bad input.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const subjectRaw = url.searchParams.get("subject") ?? "both";
  const subjectType = SUBJECT_TYPES.has(subjectRaw)
    ? (subjectRaw as "nature" | "specimen" | "both")
    : "both";
  const views = readList(url.searchParams.get("view"));
  const lifeStages = readList(url.searchParams.get("life"));
  const sexes = readList(url.searchParams.get("sex"));

  const count = await countSessionPool({ subjectType, views, lifeStages, sexes });
  return Response.json({ count });
}
