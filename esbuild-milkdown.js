const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['milkdown-entry.mjs'],
  bundle: true,
  format: 'cjs',
  target: 'node18',
  outfile: 'lib/milkdown-bundle.cjs',
  external: ['atom', 'electron', 'mermaid'],
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
}).then(() => console.log('Milkdown bundle complete')).catch(() => process.exit(1));
