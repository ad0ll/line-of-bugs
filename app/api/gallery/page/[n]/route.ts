import { searchGallery } from "@/lib/queries/gallery";

interface Params { params: Promise<{ n: string }> }

export async function GET(req: Request, { params }: Params): Promise<Response> {
  const { n } = await params;
  const page = Math.max(1, parseInt(n, 10) || 1);
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const subjectRaw = url.searchParams.get("subject") ?? "both";
  const subject: "nature" | "specimen" | "both" =
    subjectRaw === "nature" || subjectRaw === "specimen" ? subjectRaw : "both";
  const instStr = url.searchParams.get("inst") ?? "";
  const institutions = instStr ? instStr.split(",").filter(Boolean) : [];

  const result = await searchGallery({ q, subject, institutions, page });
  return Response.json(result);
}
