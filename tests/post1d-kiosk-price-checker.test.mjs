// POST-1D executable proof: the LAN barcode price checker, executed against a real database.
//
// The code under test is the code that ships: the real `KioskService`, the real `ApiKeysService`
// (which is what actually authenticates a kiosk), and the real canonical `resolveProductUnitPrice`.
// Nothing here transcribes the logic it is checking — a transcription proves the transcription.
//
// What the wave is actually asserting, in one line: **a price on the screen is the price the customer
// will be charged.** Everything below is either that claim or a way it could quietly stop being true.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { load } from './helpers/import-ts.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't360-p1d-')), 'proof.db');
const prismaFml = path.join(ROOT, 'apps/api/prisma/schema.sqlite.prisma');
const env = { ...process.env, DATABASE_URL: `file:${DB}` };
const prisma = (args) => execFileSync('npx', ['prisma', ...args, '--schema', prismaFml], { cwd: ROOT, env, encoding: 'utf8' });
const conn = () => new DatabaseSync(DB);
// SQLite has no DATETIME type, so it enforces nothing — and a row written by hand as an ISO string is
// not comparable to one written by Prisma. Prisma stores DateTime here as INTEGER (unix ms); SQLite
// ranks TEXT above INTEGER in every comparison, so an EXPIRED hand-written date passes
// `effectiveTo >= now`. The symptom is a stale price winning over the live one, which reads as a
// pricing bug in the canonical resolver rather than a bad fixture. Same trap as the EmploymentStatus
// enum in the POST-1C suite: the fixture was wrong, the production path was right.
const now = () => new Date().toISOString();
const ms = (offsetMs = 0) => Date.now() + offsetMs;
const day = 24 * 60 * 60 * 1000;

const { KioskService } = await load('apps/api/src/kiosk/kiosk.service.ts', { platform: 'node', external: ['@prisma/client'] });
const { ApiKeysService } = await load('apps/api/src/auth/api-keys.service.ts', { platform: 'node', external: ['@prisma/client'] });
const { PrismaService } = await load('apps/api/src/prisma/prisma.service.ts', { platform: 'node', external: ['@prisma/client'] });

let prismaClient;
let kiosk;
let apiKeys;

test.before(async () => {
  prismaClient = new PrismaService({ datasourceUrl: `file:${DB}` });
  await prismaClient.$connect();
  kiosk = new KioskService(prismaClient);
  apiKeys = new ApiKeysService(prismaClient);
});

const OPERATOR = 'user-operator';
const operator = { sub: OPERATOR, companyId: 'acme', branchId: 'br-1', roles: ['SUPER_ADMIN'], permissions: [] };

const device = (over = {}) => ({
  sub: 'api-key:***', email: 'api-key:***', name: 'Kiosk kasir 2',
  companyId: 'acme', branchId: 'br-1', roles: ['API_KEY'],
  permissions: ['kiosk.price.read'], authType: 'API_KEY', apiKeyId: 'k-1', ...over,
});

test('the schema carries the two new columns the wave adds', () => {
  prisma(['db', 'push', '--skip-generate', '--accept-data-loss']);
  const apiKey = conn().prepare('PRAGMA table_info(ApiKey)').all().map((r) => r.name);
  assert.ok(apiKey.includes('branchId'), 'ApiKey must be able to pin itself to one branch');
  assert.ok(apiKey.includes('locationLabel'));
  const product = conn().prepare('PRAGMA table_info(Product)').all();
  const visibility = product.find((r) => r.name === 'allowCustomerStockVisibility');
  assert.ok(visibility, 'Product must carry an explicit customer-visibility switch');
  // Fail closed. Defaulting this to true would put "stok habis" on every customer screen in the estate
  // the moment the column was added, which is the worst possible default for a column nobody reviewed.
  // Prisma pushes `@default(false)` into SQLite as the literal string 'false', so Number('false') is
  // NaN and a numeric comparison here would fail for a schema that is correct.
  assert.match(String(visibility.dflt_value), /^(0|false|'false')$/i, 'customer stock visibility must default to OFF');
});

function seed() {
  const c = conn();
  c.exec(`DELETE FROM AuditLog; DELETE FROM Inventory; DELETE FROM Warehouse; DELETE FROM ProductPrice;
          DELETE FROM PromoRule; DELETE FROM ApiKey; DELETE FROM Product; DELETE FROM Branch; DELETE FROM Company;
          DELETE FROM Permission; DELETE FROM User;`);
  const company = (id, name) => c.prepare('INSERT INTO Company (id, name, timezone, currency, createdAt, updatedAt) VALUES (?,?,?,?,?,?)')
    .run(id, name, 'Asia/Makassar', 'IDR', now(), now());
  company('acme', 'Acme');
  company('other', 'Other Co');
  const branch = (id, companyId, code) => c.prepare('INSERT INTO Branch (id, companyId, code, name, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)')
    .run(id, companyId, code, `Cabang ${code}`, 1, ms(), ms());
  branch('br-1', 'acme', 'BR1');
  branch('br-2', 'acme', 'BR2');
  branch('br-x', 'other', 'BRX');
  // A branch carrying no branch-wide promo at all. The promo query returns rules in insertion order and
  // takes the first match, so on br-1 the always-applicable rule pr-1 shadows everything after it — which
  // made the min-quantity assertion vacuous: it could pass with or without the filter. NEGCTL "a
  // min-quantity promo is advertised" stayed GREEN and exposed exactly this.
  branch('br-3', 'acme', 'BR3');
  const warehouse = (id, branchId) => c.prepare('INSERT INTO Warehouse (id, code, name, branchId, isActive, isDefault, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, `W-${id}`, `Gudang ${id}`, branchId, 1, 1, ms(), ms());
  // A real operator row. Every ApiKey create/revoke/rotate writes an AuditLog row keyed on
  // `userId: user.sub`, so a test that calls those methods with a made-up id fails on a foreign key
  // violation and never reaches the behaviour it is meant to be checking.
  c.prepare('INSERT INTO User (id, branchId, name, email, passwordHash, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
    .run(OPERATOR, 'br-1', 'Operator', 'operator@acme.test', 'x', 1, ms(), ms());

  warehouse('wh-1', 'br-1');
  warehouse('wh-2', 'br-2');
  warehouse('wh-x', 'br-x');
  warehouse('wh-3', 'br-3');

  const product = (id, companyId, sku, barcode, name, salePrice, isActive = 1, visible = 0) => c.prepare(
    'INSERT INTO Product (id, companyId, sku, barcode, name, costPrice, salePrice, unit, isActive, allowCustomerStockVisibility, createdAt, updatedAt)'
    + ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(id, companyId, sku, barcode, name, 7000, salePrice, 'pcs', isActive, visible, ms(), ms());
  product('p-1', 'acme', 'SKU-1', 'BC-1', 'Kopi 250g', 15000);
  product('p-2', 'acme', 'SKU-2', 'BC-2', 'Teh 100g', 8000, 1, 1);            // opts in to stock visibility
  product('p-off', 'acme', 'SKU-OFF', 'BC-OFF', 'Produk Nonaktif', 5000, 0); // inactive
  product('p-foreign', 'other', 'SKU-X', 'BC-X', 'Produk Tenant Lain', 99000);
  product('p-3', 'acme', 'SKU-3', 'BC-3', 'Kopi Bubuk', 12000);

  // Canonical branch pricing. br-1 sells p-1 at 15000 via a branch row, so a kiosk that ignored
  // ProductPrice and read salePrice would return 16000 here — a wrong number on a customer screen.
  c.prepare('INSERT INTO ProductPrice (id, productId, branchId, segmentCode, minQty, price, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('pp-1', 'p-1', 'br-1', 'RETAIL', 1, 13500, 1, ms(), ms());
  c.prepare('INSERT INTO ProductPrice (id, productId, branchId, segmentCode, minQty, price, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('pp-2', 'p-1', 'br-2', 'RETAIL', 1, 16500, 1, ms(), ms());
  // An expired row must not win, even though it is cheaper and branch-specific.
  c.prepare('INSERT INTO ProductPrice (id, productId, branchId, segmentCode, minQty, price, isActive, effectiveTo, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('pp-old', 'p-1', 'br-1', 'RETAIL', 1, 5000, 1, ms(-day), ms(), ms());

  const stock = (warehouseId, productId, available) => c.prepare('INSERT INTO Inventory (id, warehouseId, productId, quantity, reserved, available, updatedAt) VALUES (?,?,?,?,?,?,?)')
    .run(`inv-${productId}-${warehouseId}`, warehouseId, productId, available, 0, available, ms());
  stock('wh-1', 'p-1', 4);
  stock('wh-1', 'p-2', 0);

  const promo = (id, name, code, extra = {}) => c.prepare(
    'INSERT INTO PromoRule (id, companyId, branchId, name, code, type, value, minSubtotal, channel, productIds, startsAt, endsAt, isActive, createdAt, updatedAt)'
    + ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(id, 'acme', 'br-1', name, code, 'PERCENT', 10, 0, extra.channel ?? 'ALL',
    extra.productIds === null ? null : JSON.stringify(extra.productIds ?? null),
    ms(-day), extra.endsAt ?? null, 1, ms(), ms());
  promo('pr-1', 'Promo Gula', 'GULA10');
  promo('pr-2', 'Promo Minimum Belanja', 'BELI3', { minQuantity: 3 });
  promo('pr-3', 'Promo Produk Lain', 'LAIN', { productIds: ['p-2'] });
  promo('pr-4', 'Promo Kanal Kiosk', 'KIOSK5', { channel: 'KIOSK' });
  promo('pr-5', 'Promo Sudah Berakhir', 'LAMA', { endsAt: ms(-day) });
  promo('pr-6', 'Promo Kanal Toko', 'TOKO', { channel: 'STORE' });

  // The only promo on br-3: a basket rule. One scanned item cannot satisfy minQuantity 3, so a kiosk must
  // show nothing here rather than advertise a discount the customer cannot use at this screen.
  c.prepare('INSERT INTO PromoRule (id, companyId, branchId, name, code, type, value, minSubtotal, channel, productIds, minQuantity, startsAt, endsAt, isActive, createdAt, updatedAt)'
    + ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    // A distinct code: PromoRule is branch-scoped but @@unique([companyId, code]) is company-scoped, so
    // two rules in one company may not share a code even on different branches.
    .run('pr-7', 'acme', 'br-3', 'Promo Beli 3', 'BR3BELI3', 'PERCENT', 10, 0, 'ALL', null, 3, ms(-day), null, 1, ms(), ms());

  c.prepare('INSERT INTO Permission (id, code, description) VALUES (?,?,?)').run('perm-k', 'kiosk.price.read', 'Kiosk');
}

test('a human session is refused: a kiosk is a device, not a person', async () => {
  seed();
  const asHuman = { ...device(), authType: 'JWT', roles: ['SUPER_ADMIN'], permissions: ['kiosk.price.read'] };
  // Even a super admin is refused, because the endpoint is scoped to devices. This is what makes
  // "device-scoped" a property of the endpoint rather than a note in a design document.
  await assert.rejects(() => kiosk.lookup(asHuman, 'BC-1'), /hanya untuk perangkat kios/);
});

test('the price comes from the canonical branch resolver, not from the product row', async () => {
  seed();
  const br1 = await kiosk.lookup(device(), 'BC-1');
  assert.equal(br1.price, '13500', 'branch 1 sells p-1 at 13500 via ProductPrice');
  // The whole point of the wave: the same product at a different branch is a different price, and the
  // kiosk must show the price of ITS branch.
  const br2 = await kiosk.lookup(device({ branchId: 'br-2' }), 'BC-1');
  assert.equal(br2.price, '16500');
  // And an expired price row must not win, however cheap.
  assert.notEqual(br1.price, '5000');
  // With no branch override, the product's own sale price is the canonical fallback.
  const fallback = await kiosk.lookup(device(), 'BC-2');
  assert.equal(fallback.price, '8000');
});

test('lookup by SKU works as well as barcode, and neither reveals a foreign tenant', async () => {
  seed();
  const bySku = await kiosk.lookup(device(), 'SKU-1');
  assert.equal(bySku.name, 'Kopi 250g');
  // A foreign tenant's barcode must be indistinguishable from one that does not exist — otherwise the
  // endpoint becomes a catalogue oracle for other companies' products.
  // `assert.rejects` resolves to undefined, so the error has to be caught by hand to be inspected.
  // Reading `.message` off its result is a TypeError that looks like a service failure.
  const foreign = await kiosk.lookup(device(), 'BC-X').then(() => null, (e) => e);
  assert.ok(foreign, 'a foreign barcode must be refused');
  assert.ok(!/tenant|perusahaan lain|foreign/i.test(foreign.message), 'the refusal must not name the other tenant');
  assert.match(foreign.message, /tidak ditemukan/);
  await assert.rejects(() => kiosk.lookup(device(), 'BC-OFF'), /tidak ditemukan/);
  await assert.rejects(() => kiosk.lookup(device(), '   '), /tidak ditemukan/);
});

test('no cost price and no internal fields reach a customer-facing screen', async () => {
  seed();
  const result = await kiosk.lookup(device(), 'BC-1');
  const serialised = JSON.stringify(result);
  assert.doesNotMatch(serialised, /costPrice|"cost"|7000/, 'cost price must never be serialised');
  for (const field of ['id', 'companyId', 'branchId', 'allowCustomerStockVisibility', 'isActive']) {
    assert.ok(!(field in result), `${field} is internal and must not be in a customer payload`);
  }
  assert.deepEqual(Object.keys(result).sort(), ['availability', 'barcode', 'name', 'price', 'promotion', 'sku', 'unit']);
});

test('availability is a message, and only for products that opted in', async () => {
  seed();
  // p-1 has stock 4 but has NOT opted in. Saying "Tersedia" would be a claim about a chain the kiosk
  // cannot see; saying nothing is honest.
  assert.equal((await kiosk.lookup(device(), 'BC-1')).availability, null);
  // p-2 opted in and has 0 available.
  const p2 = await kiosk.lookup(device(), 'BC-2');
  assert.equal(p2.availability.message, 'Stok habis');
  assert.doesNotMatch(JSON.stringify(p2.availability), /"\s*quantity|"\s*available|\d/,
    'availability is a message, never a count a customer can argue with');
});

test('a promo is named only when it is genuinely active and usable here', async () => {
  seed();
  // Branch-wide, active, no min-quantity: applicable.
  assert.equal((await kiosk.lookup(device(), 'BC-1')).promotion.name, 'Promo Gula');
  // A basket rule cannot be met by one scanned item, so it must not be advertised on this screen.
  const names = await kiosk.lookup(device(), 'BC-2');
  assert.ok(!/Minimum Belanja/.test(JSON.stringify(names.promotion)), 'a min-quantity promo must not show');
  // A rule scoped to other products must not show on this one.
  assert.ok(!/Produk Lain/.test(JSON.stringify(names.promotion)));
  // An expired rule must not show.
  assert.ok(!/Sudah Berakhir/.test(JSON.stringify(names.promotion)));
  // A promotion is never accompanied by a price the kiosk computed itself.
  assert.equal(names.price, '8000');
});

test('a promo a single scan cannot satisfy is not advertised', async () => {
  seed();
  // Isolated on br-3, whose only rule is a min-quantity promo. On br-1 the first matching rule always
  // wins, so this assertion placed there would pass whether or not the filter existed.
  const isolated = await kiosk.lookup(device({ branchId: 'br-3' }), 'BC-3');
  assert.equal(isolated.promotion, null, 'a min-quantity promo must not be shown as applicable to one item');
  assert.equal(isolated.price, '12000', 'and the price is still the canonical one');
  // The same product at br-1, where a branch-wide rule does apply, does show one.
  assert.equal((await kiosk.lookup(device(), 'BC-3')).promotion.name, 'Promo Gula');
});

test('a promo carries a name and a code, never an invented discount', async () => {
  seed();
  const { promotion } = await kiosk.lookup(device(), 'BC-1');
  assert.deepEqual(Object.keys(promotion).sort(), ['code', 'name']);
  assert.doesNotMatch(JSON.stringify(promotion), /discount|potongan|amount|percent|value/,
    'the kiosk must not compute a discount the sale engine would not honour');
});

test('a pinned kiosk key cannot be redirected to another branch', async () => {
  seed();
  const key = await apiKeys.create({ name: 'Kiosk kasir 2', scopes: ['kiosk.price.read'], branchId: 'br-1', locationLabel: 'kasir 2' },
    operator);
  // No header at all: the pin supplies the branch.
  const pinned = await apiKeys.authenticate(key.apiKey);
  assert.equal(pinned.branchId, 'br-1');
  assert.equal(pinned.permissions.join(), 'kiosk.price.read');
  // A header naming the pinned branch is accepted — the client may be sending it habitually.
  assert.equal((await apiKeys.authenticate(key.apiKey, 'br-1')).branchId, 'br-1');
  // A header naming a DIFFERENT branch is a conflict, and it is stated rather than absorbed. The
  // tempting `row.branchId ?? requestedBranchId` would silently ignore this and look like it worked.
  await assert.rejects(() => apiKeys.authenticate(key.apiKey, 'br-2'), /terikat ke cabang lain/);
  await assert.rejects(() => apiKeys.authenticate(key.apiKey, 'br-x'), /terikat ke cabang lain/);
});

test('an unpinned key keeps the header-selected behaviour it has today', async () => {
  seed();
  const key = await apiKeys.create({ name: 'Integrasi lama', scopes: ['kiosk.price.read'] },
    operator);
  // Backwards compatibility is the reason the column is nullable: an existing multi-branch integration
  // must keep working exactly as before, not be forced to pin a branch it legitimately spans.
  assert.equal((await apiKeys.authenticate(key.apiKey, 'br-2')).branchId, 'br-2');
  // And the pin cannot be set to a branch outside the caller's company.
  await assert.rejects(
    () => apiKeys.create({ name: 'Pin silang', scopes: ['kiosk.price.read'], branchId: 'br-x' },
      operator),
    /tidak ditemukan pada perusahaan ini/,
  );
});

test('a revoked kiosk key stops working immediately', async () => {
  seed();
  const key = await apiKeys.create({ name: 'Kiosk', scopes: ['kiosk.price.read'], branchId: 'br-1' },
    operator);
  assert.ok(await apiKeys.authenticate(key.apiKey));
  await apiKeys.revoke(key.id, operator);
  await assert.rejects(() => apiKeys.authenticate(key.apiKey), /tidak valid|kedaluwarsa/);
});

test('a kiosk key cannot reach a mutation, because its scope does not include one', async () => {
  seed();
  // The guard is the control here, and it is already covered by the auth suite; what this wave must
  // guarantee is that the kiosk surface never asks for a permission a device could hold. `kiosk.price.read`
  // is the only permission the seed adds, and the module declares no second route.
  const raw = fs.readFileSync(path.join(ROOT, 'apps/api/src/kiosk/kiosk.controller.ts'), 'utf8');
  // Strip comments first: the controller explains itself by quoting the decorator, and an un-stripped
  // scan counts that quote as a second route. Same mistake as a static test matching its own comment.
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const methods = [...source.matchAll(/@(Get|Post|Put|Patch|Delete)\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(methods, ['Get'], `the kiosk controller must expose exactly one read, found ${methods.join()}`);
  const declared = [...source.matchAll(/@Permissions\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(declared, ['kiosk.price.read']);
  // And the seed grants that permission to no role, so it is never inherited by accident.
  const rows = conn().prepare('SELECT COUNT(*) c FROM RolePermission rp JOIN Permission p ON p.id = rp.permissionId WHERE p.code = ?').get('kiosk.price.read');
  assert.equal(rows.c, 0, 'kiosk.price.read must be granted to no role by default');
});
