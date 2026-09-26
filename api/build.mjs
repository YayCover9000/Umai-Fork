// Bundles the API together with the Umai model schemas from ../src, so that recipes are written with exactly the
// same soukai definitions (CRDT history, RDF shape) as the web app. soukai & co. resolve from the repository root.
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

await build({
    entryPoints: ['src/server.ts'],
    outfile: 'dist/server.mjs',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    alias: {
        '@': resolve(root, 'src'),
        '@digitalbazaar/http-client': resolve(here, 'src/stubs/http-client.ts'),
    },
    external: ['@inrupt/solid-client-authn-node'],
    nodePaths: [resolve(root, 'node_modules')],
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
