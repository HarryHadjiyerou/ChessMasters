import fs from 'node:fs';
import { defineConfig } from 'vite';

// Intro video installed by tools/copy-intro-video.ps1 (null = none), baked in at build time so
// the game never has to probe for it. Restart the dev server after adding or removing one.
const introVideo = ['intro.mp4', 'intro.webm'].find((f) => fs.existsSync(`public/assets/video/${f}`));

export default defineConfig({
  base: './',
  define: { __INTRO_VIDEO__: JSON.stringify(introVideo ? `assets/video/${introVideo}` : null) },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
