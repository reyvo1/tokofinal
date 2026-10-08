import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const workspace = process.cwd();
const port = process.argv[2];
const requireFromWorkspace = createRequire(resolve(workspace, 'package.json'));

function fail(message) {
  console.error(`[next-dev] ${message}`);
  process.exit(1);
}

if (!/^\d+$/.test(port ?? '')) fail('port dev wajib berupa angka.');

let nextBin;
try {
  nextBin = requireFromWorkspace.resolve('next/dist/bin/next');
} catch (error) {
  console.error(`[next-dev] Next.js tidak ditemukan dari workspace ${workspace}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const workspacePackage = JSON.parse(readFileSync(resolve(workspace, 'package.json'), 'utf8'));
const nextPackagePath = resolve(nextBin, '..', '..', '..', 'package.json');
const installedNext = JSON.parse(readFileSync(nextPackagePath, 'utf8'));
const declaredNext = workspacePackage.dependencies?.next;
if (installedNext.version !== declaredNext) {
  fail(`Next.js runtime drift: installed=${installedNext.version} declared=${declaredNext}`);
}

const generatedDev = resolve(workspace, '.next', 'dev');
if (existsSync(generatedDev)) {
  console.log(`[next-dev] remove stale isolated dev output: ${generatedDev}`);
  rmSync(generatedDev, { recursive: true, force: true });
}

const child = spawn(process.execPath, [nextBin, 'dev', '-p', port], {
  cwd: workspace,
  env: { ...process.env, T360_NEXT_VERIFY: '0' },
  stdio: 'inherit',
});

child.on('error', (error) => fail(`Next dev gagal dijalankan: ${error.message}`));
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}
