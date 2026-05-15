import { streamImage } from "@/lib/streaming";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const response = streamImage("medium", name);
  if (!response) return new Response("not found", { status: 404 });
  return response;
}
