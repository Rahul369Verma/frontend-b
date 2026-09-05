import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // ── TESTS ─────────────────────────────────────────────────────────────────
  // This app had ~33,000 lines of React and ZERO tests — which is exactly why a
  // temporal-dead-zone bug (`Cannot access 'depTpl' before initialization`) and
  // two crash-on-load icon regressions all reached the browser. None of the
  // three were type errors or lint errors; all three were runtime errors that
  // only appear when a component actually renders. `vite build` cannot catch
  // them, and neither can eslint. Rendering each page once can, and does.
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    // Pages are large and lazily import charting libraries; the default 5s is
    // tight on a cold first render.
    testTimeout: 20000,
    include: ['src/**/*.test.{js,jsx}'],
  },
  build: {
    chunkSizeWarningLimit: 1000, // Increase limit to 1MB
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'recharts-vendor': ['recharts'],
          'ui-vendor': ['lucide-react', 'clsx', 'tailwind-merge'],
          'utils-vendor': ['axios', 'socket.io-client']
        }
      }
    }
  },
  server: {
    host: true,              // allow external network access
    port: 5173,
    watch: {
      usePolling: true
    },
    allowedHosts: [
      'wilburn-cuplike-bleatingly.ngrok-free.dev',
      '.ngrok-free.dev',
      '.ngrok.io',
    ]
  }
})
