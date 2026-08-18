import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/auth': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // NOTE: do not add '/companies' or '/users' here. These prefixes are also
      // client-side routes, and a proxy entry makes Vite hand the browser's own
      // page request to the API — loading /companies directly returns raw JSON
      // instead of the app. The proxy is unused anyway: apiClient always builds
      // an absolute baseURL. ('/projects' and '/export' below have this same
      // collision today.)
      '/transactions': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/master': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/imports': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/export': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/projects': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/batches': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
