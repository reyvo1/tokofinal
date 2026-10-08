import { createWriteStream, mkdirSync } from 'node:fs';
import { platform, release, arch } from 'node:os';
import { resolve } from 'node:path';
import { spawnNpm, printableNpmCommand } from './lib/process-runner.mjs';

const root = process.cwd();
const logsDir = resolve(root, 'logs');
mkdirSync(logsDir, { recursive: true });
const logPath = resolve(logsDir, 'diagnose-install.log');
const log = createWriteStream(logPath, { flags: 'w' });

function redact(text) {
  return String(text)
    .replace(/(https?:\/\/)([^\s:@/]+):([^\s@/]+)@/gi, '$1***:***@')
    .replace(/(_authToken\s*=\s*)\S+/gi, '$1***');
}
function write(text = '') {
  const value = redact(text);
  console.log(value);
  log.write(`${value}\n`);
}
function run(args) {
  return new Promise((done) => {
    write(`\n> ${printableNpmCommand(args)}`);
    const child = spawnNpm(args, { cwd: root, env: process.env });
    child.stdout.on('data', (d) => { const t = redact(d); process.stdout.write(t); log.write(t); });
    child.stderr.on('data', (d) => { const t = redact(d); process.stderr.write(t); log.write(t); });
    child.on('error', (e) => { write(`Gagal menjalankan npm: ${e.message}`); done(1); });
    child.on('close', (code) => done(code ?? 1));
  });
}

write('Toko360 installation diagnostics');
write(`Date     : ${new Date().toISOString()}`);
write(`OS       : ${platform()} ${release()} ${arch()}`);
write(`Node.js  : ${process.version}`);
write(`Folder   : ${root}`);
write(`HTTP_PROXY set : ${Boolean(process.env.HTTP_PROXY || process.env.http_proxy)}`);
write(`HTTPS_PROXY set: ${Boolean(process.env.HTTPS_PROXY || process.env.https_proxy)}`);

await run(['--version']);
await run(['config', 'get', 'registry']);
await run(['config', 'get', 'cache']);
await run(['config', 'get', 'proxy']);
await run(['config', 'get', 'https-proxy']);
await run(['config', 'get', 'strict-ssl']);
await run(['ping', '--fetch-timeout=30000']);
await run(['cache', 'verify']);

write(`\nDiagnosis tersimpan di: ${logPath}`);
log.end();
