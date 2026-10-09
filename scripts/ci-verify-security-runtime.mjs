#!/usr/bin/env node
/**
 * Verifies actually installed patched npm production modules and exercises the
 * native image processor. Run only after a real `npm ci --include=optional`.
 * This does not replace the high/critical npm audit or the complete UAT.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fromRoot = createRequire(path.join(root, 'package.json'));
const patched = Object.freeze({ sharp: '0.35.5', 'source-map-js': '1.2.2' });

function packageManifest(moduleName) {
  // Package exports may forbid importing package.json; resolve the executable
  // first, then walk up only within the package's own node_modules directory.
  const entry = fromRoot.resolve(moduleName);
  let directory = path.dirname(entry);
  const filename = moduleName.split('/').at(-1);
  while (directory !== path.dirname(directory)) {
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest)) {
      const json = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (json.name === moduleName) return json;
    }
    directory = path.dirname(directory);
  }
  throw new Error(`SECURITY_RUNTIME_INVALID: ${filename} manifest not found at resolved module`);
}

export async function verifyInstalledSecurityRuntime({ load = fromRoot, readManifest = packageManifest } = {}) {
  for (const [name, version] of Object.entries(patched)) {
    const manifest = readManifest(name);
    assert.equal(manifest.version, version, `SECURITY_RUNTIME_INVALID: ${name} installed at ${manifest.version}, expected ${version}`);
  }

  // This must load the actual libvips native binding from an npm ci install.
  // A 1x1 PNG is deterministic and does not read an image/file/device.
  const sharp = load('sharp');
  assert.equal(typeof sharp, 'function', 'SECURITY_RUNTIME_INVALID: Sharp entry is not executable');
  assert.equal(typeof sharp.versions?.vips, 'string', 'SECURITY_RUNTIME_INVALID: native libvips unavailable');
  const png = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ff0000ff' } }).png().toBuffer();
  assert.ok(Buffer.isBuffer(png), 'SECURITY_RUNTIME_INVALID: Sharp did not produce a buffer');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'SECURITY_RUNTIME_INVALID: native PNG output is not valid');

  const { SourceMapGenerator, SourceMapConsumer } = load('source-map-js');
  assert.equal(typeof SourceMapGenerator, 'function', 'SECURITY_RUNTIME_INVALID: source-map-js generator absent');
  assert.equal(typeof SourceMapConsumer, 'function', 'SECURITY_RUNTIME_INVALID: source-map-js consumer absent');
  const map = new SourceMapGenerator({ file: 'compiled.js' });
  map.addMapping({ source: 'original.ts', original: { line: 3, column: 2 }, generated: { line: 1, column: 0 } });
  const consumer = new SourceMapConsumer(map.toJSON());
  assert.deepEqual(consumer.originalPositionFor({ line: 1, column: 0 }), {
    source: 'original.ts', line: 3, column: 2, name: null,
  }, 'SECURITY_RUNTIME_INVALID: source-map-js mapping round-trip failed');
  return { status: 'PASS', installed: patched, nativePng: 'PASS', sourceMapRoundTrip: 'PASS' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyInstalledSecurityRuntime();
    console.log(`SECURITY INSTALLED RUNTIME PASS — sharp ${result.installed.sharp}, source-map-js ${result.installed['source-map-js']}; native PNG and source map operational`);
  } catch (error) {
    console.error('SECURITY INSTALLED RUNTIME FAIL:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
