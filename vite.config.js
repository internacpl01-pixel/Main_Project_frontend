import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// No dev proxy: apiClient.js always builds an absolute baseURL from
// VITE_API_BASE_URL, so browser requests never pass through Vite. If a proxy
// is ever reintroduced, '/companies', '/users', '/projects' and '/export' must
// stay out of it — they are also client-side routes, and a proxy entry hands
// the browser's own page request to the API, so loading the page directly
// returns raw JSON instead of the app.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
  },
})
