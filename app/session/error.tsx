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
import { T } from '@/lib/tokens';

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
    <main
      role="alert"
      aria-label="session crashed"
      style={{
        position: 'fixed',
        inset: 0,
        background: T.surface0,
        color: T.textPrimary,
        display: 'grid',
        placeItems: 'center',
        padding: '2rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem',
          maxWidth: 480,
          textAlign: 'center',
        }}
      >
        <div aria-hidden style={{ fontSize: '2.5rem' }}>
          ⚠
        </div>
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--font-display), serif',
            fontStyle: 'italic',
            fontSize: '1.4rem',
            color: 'var(--text-secondary, #cbb4d4)',
          }}
        >
          session crashed
        </p>
        <p style={{ margin: 0, fontSize: '0.95rem', lineHeight: 1.5 }}>
          the session player hit an unexpected error. you can try resuming,
          or head back home to start a new one.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={() => reset()}
            className="gallery-load-more"
            style={{ margin: 0 }}
          >
            try again
          </button>
          <a href="/" className="gallery-load-more" style={{ margin: 0 }}>
            return home
          </a>
        </div>
      </div>
    </main>
  );
}
