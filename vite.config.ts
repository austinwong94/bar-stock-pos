import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const buildId = String(Date.now());

const repoName = 'bar-stock-pos';

const isDemoBuild = process.env.VITE_DEMO_MODE === 'true';
const singleFile = process.env.VITE_SINGLE_FILE === 'true';
if(singleFile&&!isDemoBuild)throw new Error('Single-file export is only available for sample builds.');

export default defineConfig(({command}) => ({
  define: { __APP_BUILD_ID__: JSON.stringify(buildId) },
  plugins: [react(), {
    name: 'app-build-version',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: buildId }) });
    },
  }, {
    name: 'cloud-preview-boundary',
    generateBundle(_options,bundle) {
      if(isDemoBuild)return;
      for(const chunk of Object.values(bundle))if(chunk.type==='chunk'&&chunk.moduleIds.some(id=>/\/src\/lib\/demo(?:Client|Backend|Seed)\.ts$/.test(id)))throw new Error('A cloud build cannot include the preview database or its adapter.');
    },
  }],
  base: command==='build' && process.env.GITHUB_PAGES === 'true' ? `/${repoName}/` : '/',
  // The cloud factory must not import or initialise the preview database.
  resolve: command==='build'&&!isDemoBuild ? {alias:[
    {find:/^\.\/demoClient$/,replacement:fileURLToPath(new URL('./src/lib/cloudPreviewClient.ts',import.meta.url))},
    {find:/^\.\.\/lib\/demoBackend$/,replacement:fileURLToPath(new URL('./src/lib/cloudPreviewBackend.ts',import.meta.url))},
  ]} : {},
  build: {manifest:true,...(singleFile?{rollupOptions:{output:{inlineDynamicImports:true}}}:{})},
}));
