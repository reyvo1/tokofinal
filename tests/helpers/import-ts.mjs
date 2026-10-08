// Load a TypeScript module into a node test, so behaviour is EXECUTED rather than grepped.
//
// The rest of this repo's tests assert on source text, which is the right default for wiring and
// permission questions but useless for the barcode listener: its entire contract is timing
// (milliseconds between keystrokes), and no regex can prove a 5 ms burst is treated differently
// from a 300 ms one. This helper transpiles the real file with the esbuild already in node_modules
// and imports it, so the test exercises the same source the POS ships.
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../../', import.meta.url).pathname;

/**
 * Transpile a repo-relative .ts file and return its module namespace.
 *
 * @param platform 'neutral' for POS/browser modules (the default: they must not pull Node-only deps
 *   at import time) and 'node' for API modules, whose Nest decorators reach for `util` and `stream`.
 *   Getting this wrong does not fail loudly about the module under test — it fails as a wall of
 *   "Could not resolve util", which reads like a broken test file rather than a wrong flag.
 */
export async function load(relativePath, { platform = 'neutral', external = [] } = {}) {
  const source = path.join(ROOT, relativePath);
  const out = await build({
    entryPoints: [source],
    bundle: true,
    format: 'esm',
    platform,
    write: false,
    // The browser modules under test must not pull in Node-only deps at import time.
    //
    // `external` is for the opposite problem: a dependency that must NOT be inlined. Bundling the
    // Prisma client turns its CommonJS `require('node:fs')` into a dynamic require inside an ES module,
    // which throws "Dynamic require of node:fs is not supported" before a single test runs. The
    // failure names esbuild, not the module under test, so it reads as a broken harness rather than a
    // real build problem. Marking it external leaves the runtime import intact.
    external: ['react', 'next', 'next/*', ...external],
  });
  const code = out.outputFiles[0].text;
  // The emitted module must live INSIDE the repo. Node resolves a bare specifier by walking up from the
  // importing file, so a module written to the OS temp dir cannot find the repo's own node_modules —
  // which shows up as ERR_MODULE_NOT_FOUND for a package that is installed and present.
  const cache = path.join(ROOT, 'node_modules', '.cache');
  mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(path.join(cache, 't360-ts-'));
  try {
    const file = path.join(dir, 'module.mjs');
    writeFileSync(file, code);
    return await import(pathToFileURL(file).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
