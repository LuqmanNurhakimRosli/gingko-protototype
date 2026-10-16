import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Fully static: the app reads precomputed files from public/data (built by pipeline/).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
})
