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
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--font-display), serif',
            fontStyle: 'italic',
            fontSize: '1.2rem',
            color: 'var(--text-secondary)',
          }}
        >
          something went wrong
        </p>
        <p style={{ margin: 0, fontSize: '0.9rem' }}>
          the gallery hit a snag loading bugs. you can retry, or head home.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={() => reset()}
            className="gallery-load-more"
            style={{ margin: 0 }}
          >
            try again
          </button>
          <a href="/" className="gallery-load-more" style={{ margin: 0 }}>
            go home
          </a>
        </div>
      </div>
    </main>
  );
}
