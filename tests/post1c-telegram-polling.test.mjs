// POST-1C — the Telegram polling transport, executed against a real local HTTP server.
//
// The transport is the part that had no evidence at all: a command service with nothing carrying it. A
// mocked fetch would have proven the loop calls fetch; it would not have proven the request is formed
// correctly, that the offset is honoured across polls, or that a refusal actually reaches the chat. So
// this stands up an HTTP server that speaks the two Bot API calls and asserts on the wire traffic.
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { TelegramPollingWorker, createCommandRunner } from '../apps/worker/dist/telegram-polling.js';

const TOKEN = 'test-token-not-a-real-secret';

/** A minimal Bot API stand-in: queues updates, records every sendMessage. */
function startFakeTelegram(initialUpdates = []) {
  const state = { queue: [...initialUpdates], sent: [], getUpdatesCalls: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const method = req.url.split('/').pop();
      const parsed = body ? JSON.parse(body) : {};
      if (method === 'getUpdates') {
        state.getUpdatesCalls.push(parsed);
        // Telegram holds the request open until an update arrives; answering immediately is fine here.
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: state.queue.splice(0) }));
        return;
      }
      if (method === 'sendMessage') {
        state.sent.push(parsed);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: { message_id: state.sent.length } }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, description: 'method not found' }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        state,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

const update = (id, userId, text) => ({
  update_id: id,
  message: { from: { id: userId }, chat: { id: userId * 10 }, text },
});

async function withFakeTelegram(updates, fn) {
  const fake = await startFakeTelegram(updates);
  try {
    await fn(fake);
  } finally {
    await fake.close();
  }
}

test('a queued command is dispatched and its reply is sent back over HTTP', async () => {
  await withFakeTelegram([update(11, 555, '/stok 899000000001')], async (fake) => {
    const seen = [];
    const worker = new TelegramPollingWorker({
      token: TOKEN,
      baseUrl: fake.baseUrl,
      runner: createCommandRunner({
        execute: async (platformUserId, text) => {
          seen.push([platformUserId, text]);
          return { ok: true, reply: 'Kopi Premium 250g · Rp 50.000' };
        },
      }),
    });

    const result = await worker.pollOnce();

    assert.deepEqual(seen, [['555', '/stok 899000000001']], 'the runner must receive the platform id and the text');
    assert.equal(result.processed, 1);
    assert.equal(result.failed, 0);
    assert.equal(fake.state.sent.length, 1, 'exactly one reply must be sent');
    assert.equal(fake.state.sent[0].chat_id, 5550, 'the reply must go to the chat the message came from');
    assert.equal(fake.state.sent[0].text, 'Kopi Premium 250g · Rp 50.000');
    // The offset is what stops a restart from replaying every command ever sent.
    // offset 0 is Telegram's "send me everything"; the loop must send a number, not omit it.
    assert.equal(fake.state.getUpdatesCalls[0].offset, 0, 'the first poll asks from the beginning');
    assert.equal(result.highestOffset, 12);
  });
});

test('a second poll does not re-run a command the first poll already handled', async () => {
  await withFakeTelegram([update(11, 555, '/scan D-1 899000000001 4')], async (fake) => {
    let runs = 0;
    const worker = new TelegramPollingWorker({
      token: TOKEN,
      baseUrl: fake.baseUrl,
      runner: async () => { runs += 1; return { ok: true, reply: 'ok' }; },
    });

    await worker.pollOnce();
    const second = await worker.pollOnce();

    assert.equal(runs, 1, 'the same update must not be dispatched twice');
    assert.equal(second.processed, 0);
    assert.equal(fake.state.getUpdatesCalls[1].offset, 12, 'the offset must advance so Telegram stops resending');
  });
});

test('a refusal is sent to the chat, not swallowed', async () => {
  // The refusal is the security-relevant reply. A loop that dispatched the refusal and then failed to
  // send it would leave an operator with silence, which is exactly what a working bot looks like.
  await withFakeTelegram([update(21, 999, '/stok 899000000001')], async (fake) => {
    const REFUSAL = 'Identitas Telegram tidak terikat ke employee aktif. Perintah ditolak.';
    const worker = new TelegramPollingWorker({
      token: TOKEN,
      baseUrl: fake.baseUrl,
      runner: async () => { throw new Error('unreachable'); },
    });

    const result = await worker.pollOnce();

    assert.equal(result.processed, 0);
    assert.equal(result.failed, 1);
    assert.equal(fake.state.sent.length, 0, 'a runner that threw has no reply to send');
    assert.equal(result.highestOffset, 22, 'the offset still advances past a failed update');
  });

  await withFakeTelegram([update(21, 999, '/stok 899000000001')], async (fake) => {
    const REFUSAL = 'Identitas Telegram tidak terikat ke employee aktif. Perintah ditolak.';
    const worker = new TelegramPollingWorker({
      token: TOKEN,
      baseUrl: fake.baseUrl,
      runner: async () => ({ ok: false, reply: REFUSAL }),
    });
    await worker.pollOnce();
    assert.equal(fake.state.sent.length, 1);
    assert.equal(fake.state.sent[0].text, REFUSAL, 'the refusal must reach the chat verbatim');
  });
});

test('a non-command message is skipped without being counted as a failure', async () => {
  await withFakeTelegram([{ update_id: 31, message: { from: { id: 1 }, chat: { id: 2 }, photo: [{ file_id: 'x' }] } }], async (fake) => {
    let ran = false;
    const worker = new TelegramPollingWorker({
      token: TOKEN, baseUrl: fake.baseUrl, runner: async () => { ran = true; return { ok: true, reply: 'x' }; },
    });
    const result = await worker.pollOnce();
    assert.equal(ran, false, 'a photo carries no command');
    assert.equal(result.failed, 0, 'a photo is not an error worth alerting on');
    assert.equal(result.highestOffset, 32);
  });
});

test('the base URL may only be redirected outside production', async () => {
  const worker = new TelegramPollingWorker({
    token: TOKEN, baseUrl: 'http://127.0.0.1:9999', runner: async () => ({ ok: true, reply: '' }),
  });
  assert.doesNotThrow(() => worker.assertBaseUrlAllowed('development'), 'UAT must be able to point at a stand-in');
  assert.doesNotThrow(() => worker.assertBaseUrlAllowed('test'));
  assert.throws(() => worker.assertBaseUrlAllowed('production'), /production\/staging/,
    'a production worker must not be redirectable to an arbitrary host — that is token exfiltration');
  assert.throws(() => worker.assertBaseUrlAllowed('staging'), /production\/staging/);
});

test('the bot token never appears in an error surfaced to the operator', async () => {
  const errors = [];
  const worker = new TelegramPollingWorker({
    token: TOKEN,
    baseUrl: 'http://127.0.0.1:1',           // nothing listening
    runner: async () => ({ ok: true, reply: '' }),
    onError: (m) => errors.push(m),
  });
  await worker.pollOnce();
  assert.ok(errors.length, 'an unreachable Telegram must be reported, not swallowed');
  const joined = errors.join(' ');
  assert.ok(!joined.includes(TOKEN), 'the token must never reach a log line');
});

test('the API gains no route that acts on a platform id, and the command logic is not copied', async () => {
  const fs = await import('node:fs');
  // The controller says this in a comment, and the comment is the design: a route that accepts a
  // platformUserId puts the whole identity model one refactor from gone. It is tempting to solve the
  // worker's wiring problem with exactly such a route, so this asserts the refusal stays refused.
  const controller = fs.readFileSync(
    new URL('../apps/api/src/mobile-ops/mobile-ops.controller.ts', import.meta.url), 'utf8');
  const dto = fs.readFileSync(
    new URL('../apps/api/src/mobile-ops/dto/mobile-ops.dto.ts', import.meta.url), 'utf8');
  // Strip comments first. A structural assertion that does not will match the sentence explaining why
  // the rule exists — and go green precisely when someone adds the thing the sentence forbids.
  const code = controller.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /TelegramCommandService/,
    'the controller must not dispatch commands; the transport owns that');
  assert.doesNotMatch(code, /@Post\([^)]*dispatch/i,
    'no HTTP route may accept a platform id and act on it');
  // The controller binds through a validated DTO rather than accepting a raw platform id. The DTO
  // is the only HTTP boundary allowed to declare platformUserId; no dispatch route may consume it.
  assert.match(code, /@Post\('telegram\/bindings'\)/);
  assert.match(code, /bind\(@Body\(\) dto: BindMobileIdentityDto/);
  assert.match(dto, /export class BindMobileIdentityDto/);
  assert.match(dto, /platformUserId!:\s*string/);
  assert.doesNotMatch(code, /platformUserId:\s*string/, 'controller must not accept a raw platform id parameter');

  // A copy of the dispatcher in the worker would be free to disagree with the real one.
  const worker = fs.readFileSync(new URL('../apps/worker/src/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(worker, /\/buka <perangkat>/, 'the command help text must not be duplicated in the worker');
  assert.doesNotMatch(worker, /\/selisih <draftId>/, 'nor any other command line');
});
