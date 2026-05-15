import { countSessionPool } from "@/lib/queries/session";
import { parseSubject } from "@/lib/subject";

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
  const subjectType = parseSubject(url.searchParams.get("subject"));
  const views = readList(url.searchParams.get("view"));
  const lifeStages = readList(url.searchParams.get("life"));
  const sexes = readList(url.searchParams.get("sex"));
  const groups = readList(url.searchParams.get("type"));

  const count = await countSessionPool({ subjectType, views, lifeStages, sexes, groups });
  return Response.json({ count });
}
