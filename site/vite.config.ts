import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Published at https://pixelatlarge.github.io/the-lowdown/ by .github/workflows/site.yml
export default defineConfig({
  root: __dirname,
  base: '/the-lowdown/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
});
