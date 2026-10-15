import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API_TARGET = process.env.API_URL ?? 'http://localhost:4000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared/src'),
      '@': path.resolve(__dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    // Listen on every loopback family: a bare `localhost` binding ends up
    // IPv6-only on recent Node, and a browser that resolves localhost to
    // 127.0.0.1 then cannot reach the dev server at all.
    host: true,
    port: 3000,
    strictPort: true,
    // Same-origin API in development: the session cookie works without CORS.
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false, xfwd: true },
    },
  },
  preview: {
    port: 3000,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false, xfwd: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Split the large third-party libraries into their own chunks so the main
    // app bundle stays small and the build no longer trips the 500 kB warning.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-vendor')) return 'charts'
          if (id.includes('@radix-ui')) return 'radix'
          if (/node_modules\/(react|react-dom|react-router|scheduler)\//.test(id)) return 'react'
          return 'vendor'
        },
      },
    },
  },
})
