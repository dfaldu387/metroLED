import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /*
    `next dev` and `next start` both write to the build directory, so running
    them from the same checkout at the same time lets the dev server overwrite
    a production build underneath a running server - which shows up as missing
    CSS and routes that intermittently fail to respond.

    Setting NEXT_DIST_DIR gives a run its own directory so the two cannot
    collide. The end-to-end suite uses it; nothing else needs to.
  */
  distDir: process.env.NEXT_DIST_DIR || '.next',

  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
  experimental: {
    // Server Actions are used for administrative mutations only.
    serverActions: { bodySizeLimit: '1mb' },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        // The service worker must not be cached aggressively.
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
    ]
  },
}

export default nextConfig
