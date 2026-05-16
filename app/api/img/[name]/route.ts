import { streamImage } from "@/lib/streaming";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const response = streamImage("images", name, req);
  if (!response) return new Response("not found", { status: 404 });
  return response;
}
