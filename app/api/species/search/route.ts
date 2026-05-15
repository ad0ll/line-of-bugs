import { searchSpecies } from "@/lib/queries/gallery";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  if (q === null) {
    return new Response(JSON.stringify({ error: "q required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const results = await searchSpecies(q);

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60, s-maxage=300",
    },
  });
}
