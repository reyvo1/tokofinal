import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyInstalledSecurityRuntime } from '../scripts/ci-verify-security-runtime.mjs';

const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
function fakeSharp(options) {
  assert.deepEqual(options.create, { width: 1, height: 1, channels: 4, background: '#ff0000ff' });
  return {png: () => ({toBuffer: async () => Buffer.from(pngSignature)})};
}
fakeSharp.versions = {vips: '8.18.7'};

class Generator {
  addMapping(value) { this.position = value; }
  toJSON() { return this.position; }
}
class Consumer {
  constructor(position) { this.position = position; }
  originalPositionFor({line, column}) {
    if (line !== this.position.generated.line || column !== this.position.generated.column) return null;
    return {source:this.position.source, ...this.position.original, name:null};
  }
}
const valid = {
  load: name => name === 'sharp' ? fakeSharp : {SourceMapGenerator:Generator,SourceMapConsumer:Consumer},
  readManifest: name => ({name,version: name === 'sharp' ? '0.35.5' : '1.2.2'}),
};

test('installed runtime requires both patched packages plus executable native PNG and source-map roundtrip', async () => {
  const result = await verifyInstalledSecurityRuntime(valid);
  assert.deepEqual(result, {status:'PASS',installed:{sharp:'0.35.5','source-map-js':'1.2.2'},nativePng:'PASS',sourceMapRoundTrip:'PASS'});
});

test('installed runtime fails closed on stale package, unavailable binding, corrupt PNG and broken sourcemap', async () => {
  await assert.rejects(() => verifyInstalledSecurityRuntime({
    ...valid,readManifest:name=>({name,version:name==='sharp'?'0.35.4':'1.2.2'}),
  }),/expected 0.35.5/);
  await assert.rejects(() => verifyInstalledSecurityRuntime({
    ...valid,load:name=>name==='sharp'?{versions:{}}:valid.load(name),
  }),/not executable/);
  const brokenSharp = () => ({png:() => ({toBuffer:async()=>Buffer.from('bad')})});
  brokenSharp.versions = {vips:'8.18.7'};
  await assert.rejects(() => verifyInstalledSecurityRuntime({
    ...valid,load:name=>name==='sharp'?brokenSharp:valid.load(name),
  }),/native PNG output/);
  await assert.rejects(() => verifyInstalledSecurityRuntime({
    ...valid,load:name=>name==='sharp'?fakeSharp:{SourceMapGenerator:Generator,SourceMapConsumer:class {originalPositionFor(){return null;}}},
  }),/source-map-js mapping round-trip/);
});
