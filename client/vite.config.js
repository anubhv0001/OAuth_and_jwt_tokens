import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser only talks to localhost:5173. /api is proxied to the gateway, so the
// refresh-token cookie is same-origin (no CORS, SameSite=Strict works).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8080' } },
});
