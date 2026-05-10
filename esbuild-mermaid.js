const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['node_modules/mermaid/dist/mermaid.core.mjs'],
  bundle: true,
  format: 'cjs',
  target: 'node18',
  outfile: 'lib/mermaid-bundle.cjs',
  external: ['atom', 'electron'],
  platform: 'node',
  alias: {
    'node:crypto': 'crypto',
    'node:url': 'url',
    'node:process': 'process',
    'node:path': 'path',
    'node:fs': 'fs',
  },
  define: {
    'process.env.IS_PREACT': 'false',
  },
  loader: {
    '.css': 'text',
  },
}).then(() => console.log('Mermaid bundle complete')).catch(() => process.exit(1));
