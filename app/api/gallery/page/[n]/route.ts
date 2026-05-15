import { searchGallery } from "@/lib/queries/gallery";

interface Params { params: Promise<{ n: string }> }

function readList(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

export async function GET(req: Request, { params }: Params): Promise<Response> {
  const { n } = await params;
  const page = Math.max(1, parseInt(n, 10) || 1);
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const subjectRaw = url.searchParams.get("subject") ?? "both";
  const subject: "nature" | "specimen" | "both" =
    subjectRaw === "nature" || subjectRaw === "specimen" ? subjectRaw : "both";
  const institutions = readList(url.searchParams.get("inst"));
  const views = readList(url.searchParams.get("view"));
  const lifeStages = readList(url.searchParams.get("life"));
  const sexes = readList(url.searchParams.get("sex"));

  const result = await searchGallery({
    q, subject, institutions, views, lifeStages, sexes, page,
  });
  return Response.json(result);
}
