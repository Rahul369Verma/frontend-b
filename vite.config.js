import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
