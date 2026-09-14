import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
await build({
  absWorkingDir: root, entryPoints: ['web/main.tsx'], bundle: true, minify: true,
  outfile: 'assets/studio.js', format: 'esm', jsx: 'automatic',
  alias: { '@deepseek-ai/dsh-client-ui-primitives': path.join(root, 'web/primitives.tsx') },
  plugins: [{name:'web-settings',setup(b){b.onResolve({filter:/settings-scope\.ts$/},()=>({path:path.join(root,'web/settings.ts')}));}}],
  define: {'process.env.NODE_ENV':'"production"'},
});
