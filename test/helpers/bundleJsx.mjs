/**
 * Import a .jsx module in node: esbuild (installed with Vite) bundles it with
 * its imports into a temporary ES module, which is imported and deleted. Lets
 * the tests exercise the real functions the steps and components export
 * (e.g. PeerYahoo's mergeFetch, a step's validate) instead of copies.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

export async function importJsx(relFromRepo) {
  const esbuild = require('esbuild');
  const entry = new URL(`../../${relFromRepo}`, import.meta.url).pathname;
  const out = path.join(os.tmpdir(), `qv-${path.basename(relFromRepo).replace(/\W+/g, '-')}-${process.pid}-${Date.now()}.mjs`);
  await esbuild.build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out,
    jsx: 'automatic', logLevel: 'error', loader: { '.css': 'empty' },
  });
  try {
    return await import(out);
  } finally {
    fs.rmSync(out, { force: true });
  }
}
