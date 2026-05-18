// No-op stub for `next/cache`, used only in the vitest node harness.
// The real `next/cache` requires the `cacheComponents` config which is
// only honored by the Next.js dev/build server — calling `cacheTag()`
// from a plain vitest process throws. None of these symbols carry
// runtime meaning in tests (we always want fresh DB reads), so they all
// reduce to no-ops. Aliased via vitest.config.ts.
export function cacheTag(_tag: string): void {}
export function cacheLife(_profile: string): void {}
export function revalidateTag(_tag: string): void {}
export function revalidatePath(_path: string): void {}
export function updateTag(_tag: string): void {}
export function unstable_cache<T extends (...args: never[]) => unknown>(
  fn: T,
): T {
  return fn;
}
