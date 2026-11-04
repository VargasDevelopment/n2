import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Container builds embed the commit the server also reports (ADR 0020).
// Development builds leave it undefined, so they never offer an update.
const buildCommit = process.env.N2_BUILD_COMMIT;

// Development ports can move so a second copy can run beside the usual 4317/4318 pair.
const apiOrigin = `http://127.0.0.1:${process.env.N2_PORT ?? '4317'}`;

export default defineConfig({
  plugins: [react()],
  define: buildCommit ? { 'import.meta.env.N2_BUILD_COMMIT': JSON.stringify(buildCommit) } : {},
  server: {
    port: Number(process.env.N2_WEB_PORT ?? 4318),
    strictPort: true,
    proxy: {
      '/api': apiOrigin,
      '/health': apiOrigin
    }
  }
});
