import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnNpm } from './lib/process-runner.mjs';

const root = process.cwd();
const gate = (process.argv[2] ?? 'fast').toLowerCase();
if (!['fast', 'full'].includes(gate)) {
  console.error('Gate harus fast atau full.');
  process.exit(2);
}
const qualityDir = join(root, 'handoff', 'quality');
const logsDir = join(root, 'logs');
mkdirSync(qualityDir, { recursive: true });
mkdirSync(logsDir, { recursive: true });
const startedAt = new Date();
const stamp = startedAt.toISOString().replaceAll(':', '-');
const logPath = join(logsDir, `quality-${gate}-${stamp}.log`);
const stream = createWriteStream(logPath, { flags: 'a' });
const child = spawnNpm(['run', `quality:${gate}`], { cwd: root, env: process.env, stdio: ['inherit', 'pipe', 'pipe'] });

for (const channel of [child.stdout, child.stderr]) {
  channel.on('data', (chunk) => {
    process.stdout.write(chunk);
    stream.write(chunk);
  });
}
child.on('error', (error) => {
  stream.write(`\n${error.stack ?? error.message}\n`);
});
child.on('close', (code) => {
  stream.end();
  const result = {
    gate: gate.toUpperCase(),
    status: code === 0 ? 'PASSED' : 'FAILED',
    exitCode: code ?? 1,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    log: relative(root, logPath).replaceAll('\\', '/'),
  };
  writeFileSync(join(qualityDir, 'latest.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`\nQuality gate ${result.status}. Log: ${result.log}`);
  process.exit(result.exitCode);
});
