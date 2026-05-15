import { searchGallery } from "@/lib/queries/gallery";
import { parseSubject } from "@/lib/subject";

interface Params { params: Promise<{ n: string }> }

function readList(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

export async function GET(req: Request, { params }: Params): Promise<Response> {
  const { n } = await params;
  const page = Math.max(1, parseInt(n, 10) || 1);
  const url = new URL(req.url);
  const qRaw = url.searchParams.get("q") ?? "";
  const q = qRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const subject = parseSubject(url.searchParams.get("subject"));
  const institutions = readList(url.searchParams.get("inst"));
  const views = readList(url.searchParams.get("view"));
  const lifeStages = readList(url.searchParams.get("life"));
  const sexes = readList(url.searchParams.get("sex"));
  const groups = readList(url.searchParams.get("type"));

  const result = await searchGallery({
    q, subject, institutions, views, lifeStages, sexes, groups, page,
  });
  return Response.json(result);
}
