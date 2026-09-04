import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repoName = 'bar-stock-pos';

const isDemoBuild = process.env.VITE_DEMO_MODE === 'true';

export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES === 'true' ? `/${repoName}/` : '/',
  build: isDemoBuild
    ? { rollupOptions: { output: { inlineDynamicImports: true } } }
    : {},
});
