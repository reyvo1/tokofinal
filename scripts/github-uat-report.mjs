import fs from 'node:fs';
import path from 'node:path';

const out = path.join(process.cwd(), 'logs', 'github-uat');
fs.mkdirSync(out, { recursive: true });

const rows = [
  ['Full repository audit', process.env.STEP_REPO_AUDIT],
  ['UI interaction audit', process.env.STEP_UI_AUDIT],
  ['UAT env', process.env.STEP_ENV],
  ['PostgreSQL schema', process.env.STEP_SCHEMA],
  ['PostgreSQL seed', process.env.STEP_SEED],
  ['Build gate', process.env.STEP_BUILD],
  ['Payroll recovery fixture', process.env.STEP_RECOVERY],
  ['Built Browser UAT', process.env.STEP_BUILT_BROWSER],
  ['Browser UAT evidence', process.env.STEP_BROWSER],
  ['Runtime sweep start', process.env.STEP_RUNTIME_SWEEP_START],
  ['All OpenAPI runtime sweep', process.env.STEP_API_SWEEP],
  ['R1 tenant/access runtime probe', process.env.STEP_R1_TENANT_ACCESS],
  ['R2 HR/attendance/payroll runtime probe', process.env.STEP_R2_HR_PAYROLL],
  ['R4 core-business runtime probe', process.env.STEP_R4_CORE_BUSINESS],
  ['P2A mixed-UOM runtime probe', process.env.STEP_P2A_MULTI_UOM],
  ['P2 payroll runtime probe', process.env.STEP_P2_PAYROLL],
  ['R5 assets/fleet runtime probe', process.env.STEP_R5_ASSETS_FLEET],
  ['R6 scale/summary/archive/capability runtime probe', process.env.STEP_R6_SCALE_AI],
  ['P3 hidden capability productization and maturity truth', process.env.STEP_P3_PRODUCTIZATION],
  ['P4 canonical domain ownership and legacy-surface removal', process.env.STEP_P4_CANONICAL_OWNERSHIP],
  ['P5 full visual product rebuild screenshot matrix', process.env.STEP_P5_VISUAL],
  ['R3 residual payment/reporting/edge/marketplace runtime probe', process.env.STEP_R3_RESIDUAL],
  ['R7 full UI / information architecture probe', process.env.STEP_R7_UI],
  ['R8 reporting/security runtime probe', process.env.STEP_R8_REPORTING_SECURITY],
  ['R8 exact-source release evidence', process.env.STEP_R8_RELEASE],
  ['Telegram/WhatsApp provider probe', process.env.STEP_PROVIDER_PROBE],
  ['Stage 18', process.env.STEP_STAGE18],
  ['Stage 19', process.env.STEP_STAGE19],
  ['Payroll staging', process.env.STEP_PAYROLL],
  ['Stage 20 automated', process.env.STEP_STAGE20],
  ['UAT candidate fail-closed assertion', process.env.STEP_CANDIDATE],
];

const norm = (x) => x || 'not-run';
const stage20Mode = process.env.STAGE20_MODE || 'UNKNOWN';

const json = {
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || null,
  runId: process.env.GITHUB_RUN_ID || null,
  stage20Mode,
  humanUatMutated: false,
  checks: rows.map(([id, status]) => ({ id, status: norm(status) })),
};

fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(json, null, 2) + '\n');

const md = [
  '# Toko360 GitHub Automated UAT',
  '',
  `- Commit: \`${json.commit || 'unknown'}\``,
  `- Stage-20 mode: **${stage20Mode}**`,
  '- Human Stage-20 UAT: **not modified by automation**',
  '',
  '| Check | Result |',
  '|---|---|',
  ...rows.map(([id, status]) => `| ${id} | ${norm(status)} |`),
  '',
];

fs.writeFileSync(path.join(out, 'summary.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
