import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const root = process.cwd();
const policyPath = join(root, 'config', 'workflow-policy.json');
const moduleMapPath = join(root, 'config', 'module-delivery-map.json');
const activeDir = join(root, 'work-items', 'active');
const completedDir = join(root, 'work-items', 'completed');

function fail(message) {
  console.error(`Workflow error: ${message}`);
  process.exit(1);
}

function loadJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { fail(`Tidak dapat membaca ${path}: ${error.message}`); }
}

const policy = loadJson(policyPath);
const moduleMap = loadJson(moduleMapPath);
const waveIds = new Set(moduleMap.waves.map((wave) => wave.id));
const impactDomains = ['database', 'inventory', 'accounting', 'tax', 'payment', 'payroll', 'sync', 'security', 'performance'];

function parseOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith('--')) options[key] = true;
    else { options[key] = next; i += 1; }
  }
  return options;
}

function slugify(value) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function localId(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `T360-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

function findWorkItem(id) {
  for (const directory of [activeDir, completedDir]) {
    if (!existsSync(directory)) continue;
    const file = readdirSync(directory).find((name) => name.startsWith(`${id}-`) && name.endsWith('.json'));
    if (file) return join(directory, file);
  }
  return null;
}

function readItems(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ path: join(directory, name), file: name, data: loadJson(join(directory, name)) }));
}

function validateItem(item, sourceName = 'work item') {
  const errors = [];
  const requiredString = ['id', 'title', 'type', 'module', 'wave', 'phase', 'risk', 'owner', 'rollbackPlan', 'monitoringPlan', 'securityNotes'];
  for (const field of requiredString) {
    if (typeof item[field] !== 'string' || !item[field].trim()) errors.push(`${field} wajib berupa teks.`);
  }
  if (!new RegExp(policy.workItemIdPattern).test(item.id ?? '')) errors.push('Format id tidak sesuai workflow policy.');
  if (!policy.allowedTypes.includes(item.type)) errors.push(`type harus salah satu: ${policy.allowedTypes.join(', ')}.`);
  if (!policy.allowedPhases.includes(item.phase)) errors.push(`phase tidak valid: ${item.phase}.`);
  if (!policy.allowedRisks.includes(item.risk)) errors.push(`risk tidak valid: ${item.risk}.`);
  if (!waveIds.has(item.wave)) errors.push(`wave tidak terdaftar: ${item.wave}.`);
  if (!item.impacts || typeof item.impacts !== 'object') errors.push('impacts wajib tersedia.');
  else {
    for (const domain of impactDomains) {
      if (!policy.allowedImpacts.includes(item.impacts[domain])) errors.push(`impacts.${domain} harus salah satu: ${policy.allowedImpacts.join(', ')}.`);
    }
  }
  for (const field of ['dependencies', 'businessRules', 'acceptanceCriteria', 'testPlan', 'documentation']) {
    if (!Array.isArray(item[field])) errors.push(`${field} wajib berupa array.`);
  }
  if (!Array.isArray(item.acceptanceCriteria) || item.acceptanceCriteria.length === 0) errors.push('Minimal satu acceptance criterion diperlukan.');
  if (!Array.isArray(item.testPlan) || item.testPlan.length === 0) errors.push('Minimal satu test plan diperlukan.');
  if (['HIGH', 'CRITICAL'].includes(item.risk)) {
    for (const field of policy.highRiskRequiredFields) {
      if (typeof item[field] !== 'string' || item[field].trim().length < 20) errors.push(`${field} harus rinci untuk risiko ${item.risk}.`);
    }
  }
  const criticalImpact = policy.criticalImpactDomains.some((domain) => ['HIGH'].includes(item.impacts?.[domain]));
  if (criticalImpact && item.risk === 'LOW') errors.push('Risk tidak boleh LOW ketika domain kritis berdampak HIGH.');
  if (item.impacts?.database !== 'NONE' && (!item.migrationPlan || item.migrationPlan.trim().length < 20)) errors.push('migrationPlan wajib rinci bila database terdampak.');
  if (item.impacts?.inventory !== 'NONE' && !item.testPlan?.some((test) => /stock|stok|inventory|movement/i.test(test))) errors.push('Dampak inventory memerlukan test plan invariant stok/movement.');
  if (item.impacts?.accounting !== 'NONE' && !item.testPlan?.some((test) => /journal|jurnal|debit|credit|kredit/i.test(test))) errors.push('Dampak accounting memerlukan test keseimbangan jurnal/posting.');
  if (item.impacts?.tax !== 'NONE' && !item.businessRules?.some((rule) => /version|periode|effective|berlaku|pajak/i.test(rule))) errors.push('Dampak tax memerlukan aturan versi/periode pajak.');
  if (item.impacts?.sync !== 'NONE' && !item.testPlan?.some((test) => /idempot|retry|offline|sync|conflict/i.test(test))) errors.push('Dampak sync memerlukan test idempotency/retry/conflict.');
  if (item.impacts?.security !== 'NONE' && item.securityNotes?.trim().length < 20) errors.push('Dampak security memerlukan securityNotes rinci.');
  if (item.phase === 'RELEASE_READY') {
    if (!item.releaseEvidence || !Array.isArray(item.releaseEvidence) || item.releaseEvidence.length === 0) errors.push('RELEASE_READY memerlukan releaseEvidence.');
  }
  if (errors.length) return errors.map((error) => `${sourceName}: ${error}`);
  return [];
}

function commandNew(args) {
  const [type, rawTitle] = args;
  if (!type || !rawTitle) fail('Gunakan: workflow:new -- <type> <judul/slug> --module <module> --wave <W0-W7> --risk <LOW-CRITICAL>');
  if (!policy.allowedTypes.includes(type)) fail(`Type tidak valid. Pilih: ${policy.allowedTypes.join(', ')}`);
  const options = parseOptions(args.slice(2));
  if (!options.module || !options.wave) fail('--module dan --wave wajib diisi.');
  if (!waveIds.has(options.wave)) fail(`Wave tidak valid: ${options.wave}`);
  const risk = String(options.risk ?? 'MEDIUM').toUpperCase();
  if (!policy.allowedRisks.includes(risk)) fail(`Risk tidak valid: ${risk}`);
  mkdirSync(activeDir, { recursive: true });
  const id = localId();
  const slug = slugify(rawTitle);
  const path = join(activeDir, `${id}-${slug}.json`);
  if (existsSync(path)) fail(`Work item sudah ada: ${path}`);
  const now = new Date().toISOString();
  const item = {
    id,
    title: rawTitle.replace(/-/g, ' '),
    type,
    module: options.module,
    wave: options.wave,
    phase: 'INTAKE',
    risk,
    owner: options.owner ?? 'unassigned',
    featureFlag: options['feature-flag'] ?? '',
    dependencies: [],
    impacts: Object.fromEntries(impactDomains.map((domain) => [domain, 'NONE'])),
    businessRules: ['ISI aturan bisnis dan invariant modul.'],
    acceptanceCriteria: ['ISI hasil terukur yang harus tercapai.'],
    testPlan: ['ISI unit/integration/e2e/concurrency/security test yang diperlukan.'],
    migrationPlan: 'Tidak ada perubahan database; perbarui bila dampak database berubah.',
    rollbackPlan: 'Jelaskan feature flag, rollback deployment, dan compensating operation bila transaksi sudah diposting.',
    monitoringPlan: 'Jelaskan metric, log, alert, dan masa observasi setelah rilis.',
    securityNotes: 'Jelaskan autentikasi, permission, tenant scope, data sensitif, dan audit trail.',
    documentation: ['docs/DEVELOPMENT-KIT.md'],
    createdAt: now,
    updatedAt: now,
  };
  writeFileSync(path, `${JSON.stringify(item, null, 2)}\n`);
  console.log(`Work item dibuat: ${path}`);
  console.log(`Branch yang disarankan: ${type === 'bug' ? 'fix' : type}/${id.toLowerCase()}-${slug}`);
}

function commandValidate() {
  const items = [...readItems(activeDir), ...readItems(completedDir)];
  const errors = [];
  const ids = new Set();
  for (const item of items) {
    errors.push(...validateItem(item.data, item.file));
    if (ids.has(item.data.id)) errors.push(`${item.file}: id duplikat ${item.data.id}.`);
    ids.add(item.data.id);
    const expectedPrefix = `${item.data.id}-`;
    if (!basename(item.path).startsWith(expectedPrefix)) errors.push(`${item.file}: nama file harus diawali ${expectedPrefix}.`);
    const inCompleted = item.path.startsWith(resolve(completedDir));
    if (inCompleted && item.data.phase !== 'CLOSED') errors.push(`${item.file}: work item completed harus berfase CLOSED.`);
  }
  if (errors.length) {
    console.error(`Workflow validation failed (${errors.length}):\n- ${errors.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`Workflow validation passed: ${items.length} work item(s), ${moduleMap.waves.length} delivery waves.`);
}

function commandStatus() {
  const items = readItems(activeDir);
  console.log('Toko360 active delivery status');
  console.log('ID | Phase | Risk | Wave | Module | Title');
  if (!items.length) console.log('(belum ada work item aktif)');
  for (const { data } of items.sort((a, b) => (policy.phaseOrder[a.data.phase] ?? 99) - (policy.phaseOrder[b.data.phase] ?? 99))) {
    console.log(`${data.id} | ${data.phase} | ${data.risk} | ${data.wave} | ${data.module} | ${data.title}`);
  }
}

function commandAdvance(args) {
  const [id, phase] = args;
  if (!id || !phase) fail('Gunakan: workflow:advance -- <work-item-id> <phase>');
  if (!policy.allowedPhases.includes(phase)) fail(`Phase tidak valid: ${phase}`);
  const path = findWorkItem(id);
  if (!path || path.startsWith(resolve(completedDir))) fail(`Work item aktif tidak ditemukan: ${id}`);
  const item = loadJson(path);
  const currentOrder = policy.phaseOrder[item.phase] ?? 99;
  const nextOrder = policy.phaseOrder[phase] ?? 99;
  if (phase !== 'BLOCKED' && nextOrder < currentOrder) fail(`Tidak boleh mundur dari ${item.phase} ke ${phase}. Gunakan work item baru atau dokumentasikan rollback fase secara manual.`);
  item.phase = phase;
  item.updatedAt = new Date().toISOString();
  const errors = validateItem(item, basename(path));
  if (errors.length) fail(errors.join('\n'));
  writeFileSync(path, `${JSON.stringify(item, null, 2)}\n`);
  console.log(`${id} dipindahkan ke fase ${phase}.`);
}

function commandComplete(args) {
  const [id] = args;
  if (!id) fail('Gunakan: workflow:complete -- <work-item-id>');
  const path = findWorkItem(id);
  if (!path || path.startsWith(resolve(completedDir))) fail(`Work item aktif tidak ditemukan: ${id}`);
  const item = loadJson(path);
  if (!['RELEASED', 'CLOSED'].includes(item.phase)) fail('Work item hanya dapat ditutup setelah RELEASED.');
  item.phase = 'CLOSED';
  item.updatedAt = new Date().toISOString();
  const errors = validateItem(item, basename(path));
  if (errors.length) fail(errors.join('\n'));
  mkdirSync(completedDir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(item, null, 2)}\n`);
  renameSync(path, join(completedDir, basename(path)));
  console.log(`${id} ditutup dan dipindahkan ke work-items/completed/.`);
}

const [command = 'help', ...args] = process.argv.slice(2);
switch (command) {
  case 'new': commandNew(args); break;
  case 'validate': commandValidate(); break;
  case 'status': commandStatus(); break;
  case 'advance': commandAdvance(args); break;
  case 'complete': commandComplete(args); break;
  default:
    console.log(`Toko360 workflow CLI\n\nCommands:\n  new <type> <title> --module <module> --wave <W0-W7> --risk <risk>\n  validate\n  status\n  advance <id> <phase>\n  complete <id>`);
}
