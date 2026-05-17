// TEMPORARY debug endpoint — DELETE immediately after the auth dance.
// Returns length + prefix/suffix of ADMIN_PASSWORD_HASH so we can see what
// the running standalone server's process.env actually holds at request time.
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const hash = process.env.ADMIN_PASSWORD_HASH ?? "";
  return Response.json({
    length: hash.length,
    prefix: hash.slice(0, 8),
    suffix: hash.slice(-12),
    starts_with_dollar: hash.startsWith("$"),
    has_backslash: hash.includes("\\"),
  });
}
