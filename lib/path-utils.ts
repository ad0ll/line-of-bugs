/**
 * Filesystem path helpers shared across client and server.
 *
 * Kept dependency-free so it can be imported into both Next.js Client and
 * Server Components without dragging in node:path (which doesn't bundle).
 */

/**
 * Return the final path segment of a forward-slash-separated path. Used for
 * stripping the `images/` prefix from DB filename columns before they're
 * passed to `/api/img/:name` or `/api/thumb/:name`.
 *
 * Returns the input unchanged if it has no separator.
 */
export function basename(p: string): string {
  return p.split("/").pop() ?? p;
}
