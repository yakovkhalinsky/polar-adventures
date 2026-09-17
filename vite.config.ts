import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so `dist/` also works from a subfolder or file://, not just
  // a domain root.
  base: './',

  server: {
    port: 8080,
  },

  build: {
    rollupOptions: {
      output: {
        // Phaser is ~1.5MB and changes far less often than game code. Splitting
        // it into its own chunk keeps it cached across deploys.
        manualChunks: { phaser: ['phaser'] },
      },
    },
  },
});
