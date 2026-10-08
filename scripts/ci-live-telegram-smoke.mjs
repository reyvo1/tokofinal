import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const evidencePath = path.resolve('handoff/quality/github-live-telegram-smoke-latest.json');
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });

function writeEvidence(payload) {
  fs.writeFileSync(evidencePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function fail(message, detail = {}) {
  writeEvidence({
    status: 'FAIL',
    gate: 'GITHUB_LIVE_TELEGRAM_SMOKE',
    checkedAt: new Date().toISOString(),
    productionTouched: false,
    ...detail,
    error: message,
  });
  throw new Error(message);
}

if (process.env.GITHUB_ACTIONS !== 'true') fail('Live Telegram smoke hanya boleh dijalankan dari GitHub Actions.');
if (process.env.T360_UAT_ENVIRONMENT !== 'GITHUB_LIVE_PROVIDER_UAT') fail('T360_UAT_ENVIRONMENT harus GITHUB_LIVE_PROVIDER_UAT.');

const token = process.env.T360_LIVE_TELEGRAM_BOT_TOKEN?.trim();
const chatId = process.env.T360_LIVE_TELEGRAM_CHAT_ID?.trim();
if (!token) fail('Secret T360_LIVE_TELEGRAM_BOT_TOKEN belum tersedia.');
if (!chatId) fail('Secret T360_LIVE_TELEGRAM_CHAT_ID belum tersedia.');

const runIdentity = `${process.env.GITHUB_REPOSITORY ?? 'repo'}#${process.env.GITHUB_RUN_ID ?? 'unknown'}:${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`;
const message = [
  'TOKO360 GitHub LIVE Telegram provider smoke',
  `Run: ${runIdentity}`,
  `Commit: ${(process.env.GITHUB_SHA ?? 'unknown').slice(0, 12)}`,
  'Purpose: verify protected provider credentials + outbound Telegram connectivity.',
].join('\n');

const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
});
const raw = await response.text();
let body = null;
try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }

if (!response.ok || body?.ok !== true) {
  fail(`Telegram live provider menolak request (${response.status}).`, {
    httpStatus: response.status,
    providerOk: body?.ok === true,
    providerDescription: typeof body?.description === 'string' ? body.description.slice(0, 240) : null,
  });
}

writeEvidence({
  status: 'PASS',
  gate: 'GITHUB_LIVE_TELEGRAM_SMOKE',
  checkedAt: new Date().toISOString(),
  productionTouched: false,
  provider: 'TELEGRAM',
  httpStatus: response.status,
  providerOk: true,
  chatIdentityHash: crypto.createHash('sha256').update(chatId).digest('hex'),
  messageId: body?.result?.message_id ?? null,
  github: {
    repository: process.env.GITHUB_REPOSITORY ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    sha: process.env.GITHUB_SHA ?? null,
  },
});

console.log(`LIVE Telegram provider PASS. Evidence: ${evidencePath}`);
