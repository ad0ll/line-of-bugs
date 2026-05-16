'use client';

/**
 * Next.js App Router error boundary for the /session route. Catches uncaught
 * render errors from SessionPlayer (preload-manager failures, audio init
 * crashes, malformed pool data) and renders a recovery UI that lets the user
 * bail back to home without leaving them stuck on a black screen.
 *
 * The error message is logged but not surfaced verbatim — pool internals
 * shouldn't leak to UI.
 */
import { useEffect } from 'react';
import Link from 'next/link';

export default function SessionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('session error boundary caught:', error);
  }, [error]);

  return (
    <main role="alert" aria-label="session crashed" className="session-crash">
      <div className="session-crash-card">
        <div aria-hidden className="session-crash-icon">⚠</div>
        <p className="session-crash-title">session crashed</p>
        <p className="session-crash-detail">
          the session player hit an unexpected error. you can try resuming,
          or head back home to start a new one.
        </p>
        <div className="session-crash-actions">
          <button
            type="button"
            onClick={() => reset()}
            className="gallery-load-more is-inline"
          >
            try again
          </button>
          <Link href="/" className="gallery-load-more is-inline">
            return home
          </Link>
        </div>
      </div>
    </main>
  );
}
