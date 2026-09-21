import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// No dev proxy: apiClient.js always builds an absolute baseURL from
// API_BASE_URL, so browser requests never pass through Vite. If a proxy
// is ever reintroduced, '/companies', '/users', '/projects' and '/export' must
// stay out of it — they are also client-side routes, and a proxy entry hands
// the browser's own page request to the API, so loading the page directly
// returns raw JSON instead of the app.
export default defineConfig({
  plugins: [react()],
  // Vite only loads an env var into import.meta.env if its name starts with
  // one of these prefixes -- default is just 'VITE_'. API_BASE_URL needs
  // 'API_' added here, or it stays invisible to the browser bundle no matter
  // what apiClient.js reads it as.
  envPrefix: ['VITE_', 'API_'],
  server: {
    port: 3000,
  },
})
