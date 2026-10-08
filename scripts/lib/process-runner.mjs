import { spawn, spawnSync } from 'node:child_process';
import { platform } from 'node:os';

/**
 * Build a reliable npm invocation for the target operating system.
 * Windows batch files (.cmd) must be invoked through cmd.exe when shell:false.
 */
export function npmInvocation(args = [], targetPlatform = platform(), env = process.env) {
  if (targetPlatform === 'win32') {
    return {
      command: env.ComSpec || env.COMSPEC || 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm.cmd', ...args],
    };
  }
  return { command: 'npm', args };
}

export function spawnNpm(args = [], options = {}) {
  const invocation = npmInvocation(args);
  return spawn(invocation.command, invocation.args, {
    shell: false,
    windowsHide: false,
    ...options,
  });
}

export function spawnNpmSync(args = [], options = {}) {
  const invocation = npmInvocation(args);
  return spawnSync(invocation.command, invocation.args, {
    shell: false,
    windowsHide: false,
    ...options,
  });
}

export function printableNpmCommand(args = []) {
  return `npm ${args.join(' ')}`.trim();
}
