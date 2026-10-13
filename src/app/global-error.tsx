'use client'

/**
 * Last-resort boundary: catches a failure in the root layout itself, where the
 * normal error boundary cannot run. It must render its own <html> and <body>,
 * and cannot rely on the application's styles having loaded, so everything
 * here is inline.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8fafc',
          fontFamily: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          color: '#0f172a',
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>MetroLED Intelligence could not start</h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: '#475569', marginTop: 8 }}>
            Something went wrong before the page could be prepared. Nothing was changed, and no data was lost.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 20,
              background: '#1a56db',
              color: '#fff',
              border: 0,
              borderRadius: 8,
              padding: '10px 16px',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ fontSize: 11.5, color: '#64748b', marginTop: 20 }}>Reference: {error.digest}</p>
          ) : null}
        </div>
      </body>
    </html>
  )
}
