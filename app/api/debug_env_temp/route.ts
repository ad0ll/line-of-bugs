// TEMPORARY debug endpoint — DELETE immediately after the auth dance.
import bcrypt from "bcrypt";

export async function GET(): Promise<Response> {
  const hash = process.env.ADMIN_PASSWORD_HASH ?? "";
  const testPw = "X5bLBeQrg9*zusji4F9cPBcu";
  let compareResult: boolean | string = false;
  try {
    compareResult = await bcrypt.compare(testPw, hash);
  } catch (e) {
    compareResult = "ERROR: " + (e instanceof Error ? e.message : String(e));
  }
  return Response.json({
    hash_length: hash.length,
    hash_prefix: hash.slice(0, 8),
    hash_suffix: hash.slice(-12),
    starts_with_dollar: hash.startsWith("$"),
    has_backslash: hash.includes("\\"),
    pw_compare_result: compareResult,
  });
}
