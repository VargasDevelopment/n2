import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['src/testSetup.ts'],
    // Card layout guarantees are asserted against the real stylesheet. The toast, edge and overlay
    // stylesheets load as raw text that only their rule tests read, so other tests stay unstyled.
    css: {
      include: [/N2Node\.css$/u, /(Notifications|N2Edge|CanvasOverlays)\.css\?raw$/u]
    }
  }
});
