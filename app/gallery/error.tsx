'use client';

/**
 * Next.js App Router error boundary for the gallery route. Catches
 * uncaught render errors from the page (DB/cache failures, malformed
 * filter URLs, etc.) and renders a recovery UI with a "try again"
 * button that calls `reset()` to re-render the route.
 *
 * The error itself is logged in dev/server but not surfaced verbatim
 * to the user — the message could leak DB internals.
 */
import { useEffect } from 'react';
import Link from 'next/link';

export default function GalleryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('gallery error boundary caught:', error);
  }, [error]);

  return (
    <main className="gallery-page">
      <div className="gallery-empty" role="alert">
        <div className="gallery-empty-icon" aria-hidden>
          ✿
        </div>
        <p className="gallery-empty-title">something went wrong</p>
        <p className="gallery-empty-hint">
          the gallery hit a snag loading bugs. you can retry, or head home.
        </p>
        <div className="gallery-empty-actions">
          <button
            type="button"
            onClick={() => reset()}
            className="gallery-load-more is-inline"
          >
            try again
          </button>
          <Link href="/" className="gallery-load-more is-inline">
            go home
          </Link>
        </div>
      </div>
    </main>
  );
}
