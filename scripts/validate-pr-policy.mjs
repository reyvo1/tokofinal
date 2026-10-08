import { readFileSync } from 'node:fs';

const policy = JSON.parse(readFileSync('config/workflow-policy.json', 'utf8'));
const title = process.env.PR_TITLE ?? '';
const body = process.env.PR_BODY ?? '';
const branch = process.env.PR_BRANCH ?? '';
const errors = [];

const prefixPattern = new RegExp(`^(${policy.branchPrefixes.join('|')})/`);
if (!prefixPattern.test(branch)) errors.push(`Branch '${branch}' harus memakai prefix: ${policy.branchPrefixes.join(', ')}.`);
if (!/^((feat|fix|security|migration|integration|perf|docs|refactor|hotfix|release)(\([^)]+\))?:|Revert )/.test(title)) {
  errors.push('Judul PR harus mengikuti Conventional Commits, misalnya feat(inventory): tambah opname parsial.');
}
if (!/T360-[0-9]{8}-[0-9]{6}/.test(body) && !branch.startsWith('release/')) errors.push('PR harus menyebut Work item ID T360-YYYYMMDD-HHMMSS.');
for (const section of policy.requiredPrSections) {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`(^|\\n)#{1,3}\\s*${escaped}\\s*($|\\n)`, 'i').test(body)) errors.push(`Bagian PR wajib belum ditemukan: ${section}.`);
}
if (/- \[ \]/.test(body)) errors.push('PR masih mempunyai checklist wajib yang belum dicentang.');

if (errors.length) {
  console.error(`PR policy failed:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log('PR policy passed.');
