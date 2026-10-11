import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  // In production these pages are served by Express from the same origin, so
  // every API call is a same-origin relative path and there is no CORS story
  // to get wrong. In development the pages come from Vite on 5173 and the API
  // runs on 3000, so those same relative paths are proxied across rather than
  // rewritten to an absolute URL. The fetch code is then identical in both,
  // and there is no VITE_API_URL to forget to set.
  //
  // The pattern matches only the four API paths under /:slug. /studio-wien and
  // /studio-wien/manage are pages and must stay with Vite.
  server: {
    port: 5173,
    proxy: {
      '^/[^/]+/(services|availability|appointments)(/.*)?$': 'http://localhost:3000',
    },
  },

  build: {
    // Express serves this directory. Matches the COPY in backend/Dockerfile.
    outDir: 'dist',
    sourcemap: true,
  },
});
