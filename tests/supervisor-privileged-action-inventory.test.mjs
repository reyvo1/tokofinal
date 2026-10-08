// An action the product advertises but never enforces is worse than no action at all: the till asks
// a supervisor to approve something, the supervisor approves it, and nothing checks the grant.
//
// That was `SALE_REFUND`. It appeared in three places — the `PrivilegedAction` union in the service,
// the controller's `@IsIn(PRIVILEGED_ACTIONS)` whitelist, and the POS copy of the union — while NO
// code anywhere in the repository called `consume(grantId, 'SALE_REFUND', ...)`. Refunds were already
// gated for real, by role (CASHIER files, OWNER/FINANCE/ADMIN/WAREHOUSE confirms). So the enum
// advertised a second, imaginary control on top of a genuine one.
//
// This test states the rule rather than the outcome:
//
//   every member of the enum must be EITHER spent by a business path (`consume(grantId, 'X', ...)`)
//   OR provably unreachable (no such path can be driven at all).
//
// It is deliberately written against the rule, not against "SALE_REFUND is gone", so the next action
// added to the enum without a gate fails here too. `SALE_PRICE_OVERRIDE` is the one legal exception:
// the DTO carries no `unitPrice`, so `forbidNonWhitelisted` makes the override unreachable by
// construction. That is asserted, not assumed — see the unreachable-reason block below.
//
// Two parser traps this avoids, both of which make a scan report a clean zero instead of an error:
//   - comments are stripped before every match, or the file explains this exact bug and matches its
//     own explanation (the failure mode that already happened in `supervisor-approval-control.test.mjs`);
//   - the enum is parsed with the TypeScript AST, not a regex, and the result is asserted non-empty,
//     so a parser that silently reads nothing fails hard instead of "passing".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const require = createRequire(new URL('apps/api/package.json', new URL('../', import.meta.url)));
const ts = require('typescript');

/** Executable code only — the comments in these files name the very strings we assert about. */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const SERVICE = 'apps/api/src/supervisor-approval/supervisor-approval.service.ts';
const CONTROLLER = 'apps/api/src/supervisor-approval/supervisor-approval.controller.ts';

/** Read the union members out of the real AST, following alias chains if the type is ever re-exported. */
function parseEnumActions(file) {
  const text = read(file);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const actions = [];
  const visit = (node) => {
    if (ts.isUnionTypeNode(node)) {
      for (const member of node.types) {
        if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) {
          actions.push(member.literal.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return actions;
}

/** The `@IsIn` whitelist literal, by name — the controller re-declares the list, so it is its own source of truth. */
function parseControllerActions() {
  const text = read(CONTROLLER);
  const source = ts.createSourceFile(CONTROLLER, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'PRIVILEGED_ACTIONS') {
      const init = node.initializer;
      if (init && ts.isArrayLiteralExpression(init)) {
        for (const el of init.elements) {
          if (ts.isStringLiteral(el)) found.push(el.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Every `consume(grantId, '<ACTION>', ...)` call in the API source tree. */
function parseConsumedActions() {
  const consumed = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue;
      // Strip comments so a grant's doc comment cannot be counted as its enforcement.
      const text = stripComments(fs.readFileSync(full, 'utf8'));
      for (const match of text.matchAll(/consume\(\s*[^,]+,\s*'([A-Z_]+)'/g)) {
        const action = match[1];
        if (!consumed.has(action)) consumed.set(action, new Set());
        consumed.get(action).add(path.relative(ROOT, full));
      }
    }
  };
  walk(path.join(ROOT, 'apps/api/src'));
  return consumed;
}

/** Actions that no path can reach at all, with the reason that makes each one unreachable. */
const PROVABLY_UNREACHABLE = new Map([
  ['SALE_PRICE_OVERRIDE', () => {
    const dto = stripComments(read('apps/api/src/sales/dto/create-sale.dto.ts'));
    const saleItem = dto.slice(dto.indexOf('class SaleItemDto'), dto.indexOf('class SalePaymentDto'));
    // A client-supplied price is what "price override" would mean, and it must be impossible.
    assert.doesNotMatch(saleItem, /unitPrice/,
      'SALE_PRICE_OVERRIDE is only unreachable while SaleItemDto has no unitPrice');
    const main = read('apps/api/src/main.ts');
    assert.match(main, /forbidNonWhitelisted: true/,
      'so sending one is a hard 400 rather than a silently ignored field');
  }],
]);

test('the enum parses, and the controller whitelist matches it exactly', () => {
  const actions = parseEnumActions(SERVICE);
  // Anti-vacuous guard: an empty parse must fail loudly. A regex that stopped matching would
  // otherwise report "every action is spent" and pass.
  assert.ok(actions.length >= 4,
    `expected the PrivilegedAction union to parse to >= 4 members, got ${actions.length} (${actions.join(', ')}) — the parser is broken, not the code`);
  assert.deepEqual([...new Set(actions)], actions, 'the union must not repeat a member');

  const controllerActions = parseControllerActions();
  assert.deepEqual(controllerActions, actions,
    'the @IsIn whitelist and the PrivilegedAction union are two declarations of one list; they must not drift');
});

test('the POS copy of the enum matches the API, so the till cannot request a phantom action', () => {
  const posActions = parseEnumActions('apps/pos/lib/supervisor.ts');
  assert.ok(posActions.length >= 4, `POS union parsed to ${posActions.length} members — parser broken?`);
  assert.deepEqual(posActions, parseEnumActions(SERVICE),
    'POS and API declare the same action list; a POS-only action would 400 on @IsIn');
});

test('every privileged action is spent by a business path, or provably unreachable', () => {
  const consumed = parseConsumedActions();
  const actions = parseEnumActions(SERVICE);
  const orphans = actions.filter((action) => !consumed.has(action) && !PROVABLY_UNREACHABLE.has(action));
  assert.deepEqual(orphans, [],
    `these actions can be approved but are never consumed, so the grant is a rubber stamp: ${orphans.join(', ')}`);

  // Say how much was actually examined, so a zero here means "zero orphans of N actions" rather than
  // an unstated denominator.
  const spent = actions.filter((action) => consumed.has(action));
  assert.ok(spent.length >= 3,
    `expected at least 3 gated actions to be found, got ${spent.length} — the consumer scan is not reading the tree`);
});

test('each unreachable action is still verified to BE unreachable', () => {
  // Do not take the exemption on trust: run its reason. If someone adds `unitPrice` to the DTO, the
  // action becomes reachable and must therefore acquire a real gate — this fails instead of silently
  // staying exempt.
  assert.ok(PROVABLY_UNREACHABLE.size >= 1, 'the exemption table must not be empty by accident');
  for (const [action, prove] of PROVABLY_UNREACHABLE) {
    prove();
    const consumed = parseConsumedActions();
    assert.equal(consumed.has(action), false,
      `${action} is listed as unreachable but a consume() call now exists — drop the exemption and require a gate instead`);
  }
});

test('the removed SALE_REFUND is gone from every declaration, and refunds are still gated by role', () => {
  // The specific historical instance, so a later wave cannot quietly re-add the string. The general
  // rule above is the real guard; this one states the outcome in a form a reader can check.
  for (const file of [SERVICE, CONTROLLER, 'apps/pos/lib/supervisor.ts']) {
    // Strip comments first — a naive substring check on this file matched the doc comment I wrote to
    // explain the removal, which is the exact failure mode documented in
    // `supervisor-approval-control.test.mjs` (it failed because the file NAMES localStorage to explain
    // why it is not used). What must be absent is the DECLARATION, not the explanation.
    assert.doesNotMatch(stripComments(read(file)), /SALE_REFUND/,
      `${file} advertises SALE_REFUND again — no return path spends such a grant`);
  }

  // Removing an enum member must not remove the REAL control with it. The role split is what actually
  // governs refunds. Line-scoped, because this repo writes the decorator and the handler on ONE line:
  // a positional slice across lines can capture the wrong decorator, which would fail for a reason
  // that has nothing to do with the behaviour. `tests/post1c-return-approval-role-guard.test.mjs`
  // covers the same policy by EXECUTING RolesGuard against the real decorator metadata; this is the
  // cheap reminder that the declaration still says it.
  const returns = read('apps/api/src/returns/returns.controller.ts');
  const confirmLine = returns.split('\n').find((line) => line.includes("@Post('sales/:id/confirm')"));
  assert.ok(confirmLine, 'the sale-return confirm endpoint must exist');
  assert.match(confirmLine, /@Roles\([^)]*'OWNER'[^)]*'FINANCE'/,
    'confirming a refund must require OWNER or FINANCE — that is the control SALE_REFUND never was');
  assert.doesNotMatch(confirmLine, /'CASHIER'/,
    'a CASHIER must not be able to finalise the refund they filed');
  assert.match(confirmLine, /@Permissions\('sale\.refund'\)/,
    'and finalising must need a different permission from filing it, so one can be revoked alone');
});