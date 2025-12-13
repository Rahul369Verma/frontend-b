import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,              // allow external network access
    port: 5173,
    allowedHosts: [
      'wilburn-cuplike-bleatingly.ngrok-free.dev',
      '.ngrok-free.dev',
      '.ngrok.io',
    ]
  }
})
