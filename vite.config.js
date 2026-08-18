import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// The dev proxy reads the same VITE_API_BASE_URL the app does, so the backend
// address is written down once. It used to be typed out beside every route,
// which meant pointing the app at a deployed backend left seven copies behind
// still naming localhost.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_API_BASE_URL || 'http://localhost:8000'

  return {
    plugins: [react()],
    server: {
      port: 3000,
      proxy: {
        '/auth': { target, changeOrigin: true },
        // NOTE: do not add '/companies' or '/users' here. These prefixes are also
        // client-side routes, and a proxy entry makes Vite hand the browser's own
        // page request to the API — loading /companies directly returns raw JSON
        // instead of the app. The proxy is unused anyway: apiClient always builds
        // an absolute baseURL. ('/projects' and '/export' below have this same
        // collision today.)
        '/transactions': { target, changeOrigin: true },
        '/master': { target, changeOrigin: true },
        '/imports': { target, changeOrigin: true },
        '/export': { target, changeOrigin: true },
        '/projects': { target, changeOrigin: true },
        '/batches': { target, changeOrigin: true },
      },
    },
  }
})
