import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const service = read('apps/api/src/mobile-ops/mobile-ops.service.ts');
const controller = read('apps/api/src/mobile-ops/mobile-ops.controller.ts');
const schemas = ['schema.prisma', 'schema.sqlite.prisma', 'schema.postgresql.prisma']
  .map((f) => ({ name: f, src: read(`apps/api/prisma/${f}`) }));

// POST-1C security invariants.
//
// The roadmap lists six. Each one below is a way a chat id could otherwise become a permission, so
// each is asserted structurally rather than as a comment. A comment in a bot handler is not a control.

// ---------------------------------------------------------------- binding is mandatory

test('a platform id alone can never become a permission', () => {
  // The resolution path is total and has no shortcut. Every lookup is scoped by companyId and by an
  // active binding; none of them is satisfied by the caller naming a value.
  const body = service.slice(service.indexOf('async resolveIdentity('), service.indexOf('async assertPermission('));
  assert.match(body, /if \(!platformUserId\?\.trim\(\)\) return null;/);
  assert.match(body, /where: \{ platformUserId: platformUserId\.trim\(\), isActive: true \}/);
  assert.match(body, /where: \{ id: binding\.employeeId, companyId: binding\.companyId \}/);
  // The employee is re-checked on every resolution, because a binding outlives the employment.
  assert.match(body, /if \(!employee\) return null;/);
  assert.match(body, /if \(employee\.terminationDate\) \{[\s\S]*return null;/);
  // A user lookup is also required before any role can be read.
  assert.match(body, /employee\.userId[\s\S]*where: \{ id: employee\.userId, isActive: true \}/);
});

test('roles and permissions come from the same join tables the API guard uses', () => {
  // Reimplementing the lookup would create a second, quietly divergent definition of what someone may
  // do. The divergence would only ever surface as a security incident.
  const body = service.slice(service.indexOf('async resolveIdentity('), service.indexOf('async assertPermission('));
  assert.match(body, /include: \{ roles: \{ include: \{ role: \{ include: \{ permissions: \{ include: \{ permission: true \} \} \} \} \} \} \}/);
  assert.match(body, /const roles = \(user\?\.roles \?\? \[\]\)\.map\(\(r\) => r\.role\.name\);/);
  assert.match(body, /const permissions = \[\.\.\.new Set\(\(user\?\.roles \?\? \[\]\)\.flatMap\(\(r\) => r\.role\.permissions\.map\(\(p\) => p\.permission\.code\)\)\)\];/);
});

test('branch scope comes from the employee, never from the chat', () => {
  // An employee scoped to one branch must not be able to act in another because a chat says so.
  const body = service.slice(service.indexOf('async resolveIdentity('), service.indexOf('async assertPermission('));
  assert.match(body, /branchId: employee\.branchId,/);
  assert.doesNotMatch(body, /branchId: .*dto|branchId: .*payload|branchId: .*chat/);
});

test('permission is checked, and an unbound identity is refused with a reason', () => {
  const body = service.slice(service.indexOf('async assertPermission('), service.indexOf('async listBindings('));
  assert.match(body, /if \(!identity\) \{\s*throw new ForbiddenException\('Identitas Telegram tidak terikat ke employee aktif\. Perintah ditolak\.'\);/);
  assert.match(body, /if \(!isSuperAdmin && !identity\.permissions\.includes\(permission\)\) \{[\s\S]*throw new ForbiddenException\(`Employee tidak memiliki izin \$\{permission\}\.`\)/);
  // The SUPER_ADMIN bypass must match the one the API guard uses, not a local invention.
  assert.match(body, /identity\.roles\.some\(\(r\) => r\.toUpperCase\(\) === 'SUPER_ADMIN'\)/);
});

test('an identity cannot be bound to an employee outside the caller tenant', () => {
  assert.match(service, /const employee = await this\.prisma\.employee\.findFirst\(\{ where: \{ id: dto\.employeeId, companyId \} \}\);\s*if \(!employee\) throw new NotFoundException\('Employee tidak ditemukan pada tenant ini\.'\)/);
  // A terminated employee must not be bindable at all.
  assert.match(service, /if \(employee\.terminationDate\) \{[\s\S]*throw new ForbiddenException\('Employee sudah berhenti; tidak dapat diikat ke kanal Telegram\.'\)/);
});

test('one platform identity cannot be actively bound to two employees', () => {
  // Two active bindings would mean a shared phone, which is how one person quietly operates as two
  // people with two sets of permissions.
  for (const { name, src } of schemas) {
    assert.match(src, /model TelegramIdentityBinding \{[\s\S]*@@unique\(\[platformUserId\]\)/, `${name} must keep platformUserId unique`);
  }
  assert.match(service, /if \(existing && existing\.employeeId !== employee\.id && existing\.isActive\) \{[\s\S]*throw new ForbiddenException\('Platform identity ini sudah terikat ke employee lain pada tenant ini\.'\)/);
});

test('revocation is recorded with a reason, not merely flipped', () => {
  // An audit that can only answer "is it valid now" cannot answer "was it revoked or was it never valid".
  for (const { name, src } of schemas) {
    assert.match(src, /model TelegramIdentityBinding \{[\s\S]*revokedAt\s+DateTime\?[\s\S]*revokedReason String\?/, `${name} must keep revocation evidence`);
  }
  assert.match(service, /if \(!reason\?\.trim\(\)\) throw new BadRequestException\('Pencabutan binding wajib disertai alasan\.'\)/);
  assert.match(service, /action: 'TELEGRAM_IDENTITY_REVOKED'[\s\S]*payload: \{ reason: reason\.trim\(\) \}/);
});

// ---------------------------------------------------------------- no direct writes from a bot

test('no route performs an action on behalf of a platform identity', () => {
  // This is the structural half of "no direct database writes from bot handlers". If a route accepted a
  // chat id and did something, the whole model would be one refactor from gone.
  const params = [...controller.matchAll(/@(\w+)\('([^']+)'[^)]*\)/g)].map((m) => m[2]);
  assert.ok(params.length >= 8, `expected the full mobile-ops surface, found ${params.length}`);
  for (const route of params) {
    assert.doesNotMatch(route, /platformUserId/, `${route} must not take a platform identity in its path`);
  }
  // Binding administration is an operator action on someone ELSE's identity, so it is user.manage and
  // takes the id in the body only to locate a record for revocation.
  const bodies = controller.split(/@(Get|Post|Put)\(/).slice(2).filter((_, i) => i % 2 === 0);
  for (const b of bodies) {
    assert.match(b, /@Permissions\('(?:user\.manage|inventory\.opname)'\)/, 'every mobile-ops handler must be permission gated');
    assert.doesNotMatch(b, /@Public\(\)/, 'no mobile-ops route may be public');
  }
  // Nothing in the service performs a Telegram API call, so there is no bot handler here at all — only
  // identity resolution. That keeps the security surface testable without a network dependency.
  assert.doesNotMatch(service, /api\.telegram\.org|fetch\(['"]https:\/\/api\.telegram/);
});

test('the operator binding screen never returns the platform identity itself', () => {
  const body = service.slice(service.indexOf('async listBindings('), service.indexOf('// ---------------------------------------------------------------- mobile drafts'));
  assert.match(body, /select: \{ id: true, employeeId: true, displayName: true, isActive: true, revokedAt: true, revokedReason: true, lastUsedAt: true, createdAt: true \}/);
  assert.doesNotMatch(body, /platformUserId\s*:/, 'the credential-adjacent platform identity must not be projected by listBindings');
  assert.match(body, /toCursorPage\(rows, limit/, 'binding administration must stay bounded and pageable');
});

// ---------------------------------------------------------------- drafts are not inventory

test('a draft never posts inventory or completes a StockOpname', () => {
  // Posting stock and approving a count stay behind the existing canonical lifecycle, which has its
  // own supervisor-approval rules. This wave must not weaken them.
  //
  // This assertion used to forbid `stockOpnameItem.update` outright. That locked a NAME, not the
  // behaviour, and it began failing the moment submitDraft legitimately wrote a counted quantity onto
  // an opname item — which is not a posting. The intent is narrower and is asserted as written here:
  // no inventory movement is created, no opname is created or advanced past counting, and the canonical
  // status enum keeps exactly its original states.
  assert.doesNotMatch(service, /stockOpname\.create/, 'the mobile surface must not create a StockOpname');
  assert.doesNotMatch(service, /stockOpname\.update/, 'the mobile surface must not transition a StockOpname');
  assert.doesNotMatch(service, /inventory\.(create|update|upsert)|inventoryMovement\.create/);
  assert.doesNotMatch(service, /stockOpnameItem\.(create|upsert)/, 'the mobile surface must not add or replace count lines');
  // And the only write to a count item is a quantity, never a stock movement.
  const submit = service.slice(service.indexOf('async submitDraft('), service.indexOf('async discardDraft('));
  const countWrites = [...submit.matchAll(/stockOpnameItem\.update\(/g)];
  assert.equal(countWrites.length, 1, 'submitDraft must have exactly one count-item write call site');
  assert.match(submit, /data: \{ countedQty: update\.countedQty, difference: update\.difference, reason: update\.reason \}/,
    'the mobile write may fill the canonical count fields only');
  // The canonical opname lifecycle is untouched, exactly as the offline transfer wave left it.
  const prisma = schemas[0].src;
  assert.match(prisma, /enum StockOpnameStatus \{\s*DRAFT\s+COUNTING\s+WAITING_APPROVAL\s+COMPLETED\s+CANCELLED\s*\}/);
});

test('a draft is bound to the device that captured it', () => {
  // Two devices counting the same rack must not overwrite each other's lines.
  for (const { name, src } of schemas) {
    assert.match(src, /model MobileOpnameDraft \{[\s\S]*@@unique\(\[deviceId, warehouseId, locationId, status\]\)/, `${name} must keep the device-scoped draft key`);
  }
  assert.match(service, /if \(!dto\.deviceId\?\.trim\(\)\) throw new BadRequestException\('deviceId wajib diisi; draft terikat perangkat\.'\)/);
});

test('reopening a draft resumes it rather than starting a second count', () => {
  assert.match(service, /where: \{ companyId, deviceId: dto\.deviceId\.trim\(\), warehouseId: dto\.warehouseId, locationId: dto\.locationId \?\? null, status: 'OPEN' \}/);
  // The original assertion pinned `lineCount(existing.lines)` by name, which broke the moment the
  // resume path stopped returning the raw row (it now returns the row with the opname attached).
  // What matters is that resume returns the STORED line count, not a fresh zero — assert on the
  // behaviour, not on which local variable it happens to read.
  const resume = service.slice(service.indexOf('if (existing)'), service.indexOf('this.prisma.mobileOpnameDraft.create'));
  assert.match(resume, /resumed: true/);
  assert.match(resume, /lineCount: this\.lineCount\((?:existing|draft)\.lines\)/);
  assert.doesNotMatch(resume, /lineCount: 0/, 'a resumed draft must not report an empty count');
  assert.doesNotMatch(resume, /mobileOpnameDraft\.create\(/, 'and must not start a second draft');
  assert.match(resume, /existing\.employeeId !== user\.sub/, 'a shared device must not resume another operator\'s open count');
  assert.match(resume, /Perangkat masih memiliki draft OPEN milik operator lain/, 'cross-shift device reuse must fail visibly');
});

test('rescanning the same barcode adds to the line instead of duplicating it', () => {
  // A hundred counts of the same unit is a hundred units, not a hundred lines.
  assert.match(service, /const existing = lines\.find\(\(l\) => l\.key === key\);\s*if \(existing\) existing\.quantity \+= dto\.quantity;/);
  assert.match(service, /if \(!dto\.barcode\?\.trim\(\) && !dto\.sku\?\.trim\(\)\) \{\s*throw new BadRequestException\('Scan harus membawa barcode atau SKU\.'\)/);
  assert.match(service, /if \(!Number\.isFinite\(dto\.quantity\) \|\| dto\.quantity <= 0\) \{[\s\S]*throw new BadRequestException\('Kuantitas hasil hitung harus bilangan positif\.'\)/);
});

test('a discarded draft is kept, not deleted', () => {
  // A discarded count is evidence too.
  for (const { name, src } of schemas) {
    assert.match(src, /enum MobileDraftStatus \{[\s\S]*DISCARDED/, `${name} must keep DISCARDED`);
  }
  assert.match(service, /if \(!reason\?\.trim\(\)\) throw new BadRequestException\('Membuang draft wajib disertai alasan\.'\)/);
  assert.doesNotMatch(service, /mobileOpnameDraft\.delete/);
});

test('a draft can only be filed against an opname in the same warehouse', () => {
  // Scope is centralized so open/resume and submit cannot drift into different warehouse/location rules.
  const scopeGuard = service.slice(service.indexOf('private async assertDraftScope('), service.indexOf('private async resolveDraftLines('));
  assert.match(scopeGuard, /if \(opname\.warehouseId !== warehouseId\) throw new BadRequestException\('StockOpname dan draft harus pada gudang yang sama\.'\);/);
  assert.match(scopeGuard, /opname\.locationId \?\? null\) !== \(locationId \?\? null\)/, 'location scope must match exactly too');
  assert.match(service, /Draft kosong tidak dapat dikirim\./, 'an empty draft must be refused rather than filed as a clean count');
  const submit = service.slice(service.indexOf('async submitDraft('), service.indexOf('async discardDraft('));
  assert.ok(/lines\.length === 0/.test(submit), 'the emptiness check must count the parsed lines');
  // A draft whose lines are all unparseable must count as empty, not as "one line".
  assert.match(service, /private linesOf\(raw: unknown\)/);
});

test('the draft list is reachable and tenant-scoped, and the operator screen actually calls it', () => {
  // A draft could only be fetched by its id, so a count taken on a device had no way to be seen by an
  // operator: it could sit OPEN forever with nobody aware of it. The endpoint existing is not the point —
  // the screen calling it is, because an uncalled endpoint is the same dead-surface failure in reverse.
  const ui = read('apps/admin/app/modules/mobile-ops.tsx');
  assert.match(controller, /@Get\('drafts'\)\s*\n\s*@Permissions\('inventory\.opname'\)/, 'the list must be permission gated');
  const body = service.slice(service.indexOf('async listDrafts('), service.indexOf('async getDraft('));
  assert.match(body, /const baseWhere = \{\s*companyId,/, 'every draft page must start from authenticated tenant scope');
  assert.match(body, /take: limit \+ 1/, 'the list must be bounded by cursor pagination');
  assert.match(body, /toCursorPage\(drafts, limit/, 'the bounded page must expose a continuation cursor');
  assert.match(body, /warehouse\.findMany\(\{ where: \{ id: \{ in: warehouseIds \}, branch: \{ companyId \} \}/,
    'warehouse labels must also be constrained to the authenticated tenant');
  // It reports what an operator scans for, not the raw device payload.
  assert.match(body, /awaitingFiling: draft\.status === 'OPEN' && !draft\.opnameId/);
  // `lines` must be SELECTED (lineCount needs it) but never PROJECTED into the response: the returned
  // rows are built field by field, and the device-local payload is not one of them.
  assert.match(body, /select: \{[\s\S]*?lines: true,[\s\S]*?\}/, 'lines must be selected so lineCount can be computed');
  const returnedFields = body.slice(body.indexOf('const rows = page.items.map'), body.indexOf('return {\n      rows,'));
  // `draft.lines` may be READ to compute lineCount; what must never appear is the payload being handed
  // back as a field in its own right.
  for (const row of returnedFields.split('\n')) {
    const field = row.trim().split(':')[0];
    if (field === 'lines') assert.fail(`the device-local lines payload must not be returned as a field: ${row.trim()}`);
  }
  assert.match(returnedFields, /lineCount: this\.lineCount\(draft\.lines\)/, 'and the line count must still be computed from it');
  // And the screen must use it, under the same permission the route requires.
  assert.match(ui, /req<DraftList>\(token, '\/mobile-ops\/drafts\?limit=50'\)/, 'the operator screen must call the bounded first page');
  assert.match(ui, /loadMoreDrafts/, 'the operator screen must expose continuation rather than silently truncating drafts');
  assert.match(ui, /drafts\?\.pageInfo\?\.nextCursor/, 'continuation must use the server cursor');
  assert.match(ui, /canCountStock/, 'and must be gated on the permission the route requires');
  assert.match(ui, /Lihat selisih/, 'and must expose the discrepancy review, or the count still has no reader');
  assert.match(ui, /req<Discrepancy>\(token, `\/mobile-ops\/drafts\/\$\{draftId\}\/discrepancy`\)/);
});

test('a resumed draft gets the opname it was handed, so a snapshot can exist', () => {
  // Found by the live UAT: a draft opened before a supervisor created the canonical StockOpname came
  // back with resumed:true and opnameId:"" and the opname the caller passed was dropped. The draft
  // then stayed opname-less forever, reviewDiscrepancy had no systemQty to compare against, and every
  // line read system=null — which looks like "no discrepancy found" rather than "never compared".
  // Counting before the canonical count exists, then being handed its id, is the normal sequence.
  const body = service.slice(service.indexOf('async openDraft('), service.indexOf('async addScan('));
  const resume = body.slice(body.indexOf('if (existing)'), body.indexOf('this.prisma.mobileOpnameDraft.create'));
  assert.match(resume, /!existing\.opnameId && dto\.opnameId/, 'the resume path must attach a missing opname');
  assert.match(resume, /mobileOpnameDraft\.update\(/, 'and it must be persisted, not just echoed back');
  assert.match(resume, /data: \{ opnameId: dto\.opnameId \}/);
  // Resume must stay resume: returning the stored lines is the point of a resumable count.
  assert.match(resume, /resumed: true/);
  assert.match(resume, /this\.lineCount\(draft\.lines\)/, 'and it must still report the stored lines, not start over');
});

test('submitting a draft actually writes the counts into the canonical opname items', () => {
  // This is the whole functional point of the wave, and nothing threw without it. The draft stored the
  // counted quantity on itself; `StockOpnameItem.countedQty` stayed null; the canonical submitOpname then
  // refused the opname forever with "Semua barang harus dihitung sebelum diajukan". An operator saw
  // "sent" and the count went nowhere — a success message on a dead end, invisible to every gate.
  //
  // The assertion is on the write, not on the draft's status change: `status: 'SUBMITTED'` alone is
  // exactly what the buggy version did.
  const body = service.slice(service.indexOf('async submitDraft('), service.indexOf('async discardDraft('));
  assert.match(body, /stockOpnameItem\.update\(/, 'submitDraft must write counted quantities onto the opname items');
  assert.match(body, /countedQty: entry\.counted/, 'and it must write the server-resolved base-unit quantity that was counted');
  assert.match(body, /difference: entry\.counted - item\.systemQty/, 'with the difference against the snapshot the opname captured');
  assert.match(body, /resolveDraftLines\(companyId, lines\)/, 'barcode and UOM identity must be resolved server-side before writing counts');
  assert.match(body, /ambiguousBatch/, 'multi-batch allocation must fail closed rather than guess a batch');
  // It must be one transaction: counts applied and the draft marked SUBMITTED together, or neither.
  assert.match(body, /this\.prisma\.\$transaction\(async \(tx\) => \{/, 'counts and draft status must commit together');
  assert.ok(body.indexOf('$transaction') < body.indexOf("status: 'SUBMITTED'"), 'the write must be inside the transaction that marks the draft');
  // And it still must not reach past the count: no status transition on the opname, no inventory write.
  assert.doesNotMatch(body, /stockOpname\.update\(\{ where: \{ id: opname\.id \}, data: \{ status:/, 'submitDraft must not advance the opname past counting');
  assert.doesNotMatch(body, /inventory\.(create|update|upsert)|inventoryMovement\.create/);
  // A count that cannot be mapped must be refused out loud, never dropped silently.
  assert.match(body, /if \(resolved\.unresolved\.length\) \{/);
  assert.match(body, /if \(notInOpname\.length \|\| ambiguousBatch\.length\) \{/);
  assert.match(body, /Draft tetap OPEN/);
  // Counting may only land while the opname is still open for it.
  assert.match(body, /if \(opname\.status !== 'COUNTING' && opname\.status !== 'DRAFT'\) \{/);
});

test('discrepancy review compares against the opname snapshot, not live stock', () => {
  // Reporting a difference without measuring it is the failure mode: the endpoint used to resolve
  // barcodes to products and call that a discrepancy review, so a count could be "reviewed" and show
  // nothing at all. Comparing against live Inventory instead of the snapshot would be a different bug —
  // a count opened last week silently measured against today's numbers.
  const body = service.slice(service.indexOf('async reviewDiscrepancy('), service.indexOf('async submitDraft('));
  assert.match(body, /stockOpnameItem\.findMany\(\{ where: \{ opnameId: draft\.opnameId \}/, 'the snapshot must come from the opname items');
  assert.match(body, /const difference = system === null \? null : entry\.counted - system;/, 'difference must use the same base-unit resolved count submitted to the opname');
  assert.match(body, /difference === 0/, 'and matched must be a real comparison, not a default');
  // The summary the operator reads must count the comparison, and never claim a verdict.
  assert.match(body, /overCounted: compared\.filter\(\(r\) => \(r\.difference \?\? 0\) > 0\)\.length/);
  assert.match(body, /shortCounted: compared\.filter\(\(r\) => \(r\.difference \?\? 0\) < 0\)\.length/);
  assert.doesNotMatch(body, /inventory\.findMany/, 'must not measure against live stock');
});

test('a tenant cannot reach another tenant warehouse or draft', () => {
  // Warehouse has no companyId; the tenant arrives through its branch. Scope is centralized and reused
  // by both draft opening and submission so either path cannot drift into another tenant.
  const scopeGuard = service.slice(service.indexOf('private async assertDraftScope('), service.indexOf('private async resolveDraftLines('));
  assert.match(scopeGuard, /warehouse\.findFirst\(\{ where: \{ id: warehouseId, branch: \{ companyId \} \}/);
  const open = service.slice(service.indexOf('async openDraft('), service.indexOf('async addScan('));
  const submit = service.slice(service.indexOf('async submitDraft('), service.indexOf('async discardDraft('));
  assert.match(open, /assertDraftScope\(companyId, dto\.warehouseId, dto\.locationId, dto\.opnameId\)/);
  assert.match(submit, /assertDraftScope\(companyId, draft\.warehouseId, draft\.locationId \?\? undefined, opnameId\)/);
  for (const call of ['const draft = await this.prisma.mobileOpnameDraft.findFirst({ where: { id: draftId, companyId } })', 'const binding = await this.prisma.telegramIdentityBinding.findFirst({ where: { id: bindingId, companyId } })']) {
    assert.ok(service.includes(call), `tenant scope missing: ${call.slice(0, 60)}`);
  }
});

test('canonical StockOpname completion atomically closes linked mobile drafts as POSTED', () => {
  const inventory = read('apps/api/src/advanced-inventory/advanced-inventory.service.ts');
  const complete = inventory.slice(inventory.indexOf('async completeOpname('));
  assert.match(complete, /mobileOpnameDraft\.updateMany\(\{[\s\S]*where: \{ companyId: scope\.companyId, opnameId: id, status: 'SUBMITTED' \},[\s\S]*data: \{ status: 'POSTED' \}/,
    'a completed canonical opname must terminalize linked submitted mobile drafts in the same transaction');
  assert.match(complete, /postedMobileDrafts: postedMobileDrafts\.count/, 'the canonical audit evidence must record how many drafts were closed');
});

test('Admin consumes cursor pages without hiding permission or server failures', () => {
  const ui = read('apps/admin/app/modules/mobile-ops.tsx');
  assert.match(ui, /type BindingPage = \{ items: Binding\[]; pageInfo\?: PageInfo \}/);
  assert.match(ui, /canManageUsers[\s\S]*req<BindingPage>\(token, '\/mobile-ops\/telegram\/bindings\?limit=50'\)/,
    'binding reads must only run for operators holding user.manage');
  assert.match(ui, /loadMoreBindings/);
  assert.match(ui, /Promise\.allSettled\(tasks\)/, 'independent authorized panels may load independently');
  assert.doesNotMatch(ui, /catch\(\(\) => setBindings\(\[\]\)\)|catch\(\(\) => setDrafts\(null\)\)/,
    'authorization/server failures must not be disguised as empty data');
});

test('a resolved binding records that it was used', () => {
  // lastUsedAt is read by listBindings and rendered by the operator screen as "belum pernah". Until
  // something wrote it, that column was permanently empty — a value that looks correct because null is
  // the default, which is exactly why no gate caught it. A reader with no writer is the defect.
  const body = service.slice(service.indexOf('async resolveIdentity('), service.indexOf('async assertPermission('));
  assert.match(body, /update\(\{ where: \{ id: binding\.id \}, data: \{ lastUsedAt: new Date\(\) \} \}\)/);
  // It must be written only on the success path. indexOf would find the FIRST refusal, which sits
  // above the write and would make this assertion pass no matter where the write actually was — the
  // check has to be against the LAST refusal in the method, and it has to exist at all.
  const refusals = [...body.matchAll(/return null;/g)];
  assert.ok(refusals.length >= 4, `expected several refusal paths in resolveIdentity, found ${refusals.length}`);
  const lastRefusalAt = refusals[refusals.length - 1].index;
  const writtenAt = body.indexOf('lastUsedAt');
  assert.ok(writtenAt > lastRefusalAt, `lastUsedAt is written at ${writtenAt}, before the last refusal at ${lastRefusalAt}; a refused identity would look recently used`);
  // And the bookkeeping must never be able to fail a command: an unresolvable operator identity has to
  // stay denied whether or not a timestamp could be stored.
  assert.match(body, /\.catch\(\(error: unknown\) => this\.logger\.warn\(/);
});

test('revoke is addressed by a key the operator screen actually holds', () => {
  // The list endpoint deliberately withholds platformUserId, so a revoke keyed on it can never be
  // driven from that screen: every call 404s and the operator's only remedy is a support ticket.
  // This asserts the contract rather than the field name — the UI's payload and the route's DTO must
  // name the same thing, and it must be something the UI is allowed to know.
  const ui = read('apps/admin/app/modules/mobile-ops.tsx');
  const key = [...ui.matchAll(/telegram\/bindings\/revoke'[^\n]*JSON\.stringify\(\{ (\w+): revokeTarget\./g)]
    .map((m) => m[1]);
  assert.equal(key.length, 1, `expected exactly one revoke call site in the UI, found ${key.length}`);
  const route = controller.slice(controller.indexOf("@Put('telegram/bindings/revoke')"), controller.indexOf("@Post('drafts/open')"));
  const dtoField = [...route.matchAll(/dto\.(\w+)/g)].map((m) => m[1]);
  assert.ok(dtoField.includes(key[0]), `UI sends "${key[0]}" but the revoke route accepts ${JSON.stringify(dtoField)}`);
  assert.doesNotMatch(route, /platformUserId/, 'revoke must not require the credential the operator screen never receives');
  // And the service must resolve that key, tenant-scoped, rather than re-deriving another one.
  assert.match(service, /async revokeBinding\(user: AuthUser, bindingId: string, reason: string\)/);
  assert.match(service, /telegramIdentityBinding\.findFirst\(\{ where: \{ id: bindingId, companyId \} \}\)/);
});

test('the module is registered', () => {
  const app = read('apps/api/src/app.module.ts');
  assert.match(app, /import \{ MobileOpsModule \} from '\.\/mobile-ops\/mobile-ops\.module';/);
  assert.match(app, /\n    MobileOpsModule,/);
});
