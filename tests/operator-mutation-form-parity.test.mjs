import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, ROOT), 'utf8');

// Seven mutating backend routes had a @Permissions guard and were reachable only from a
// device, a webhook, or a database insert. Each is a plain create form the operator obviously
// needs: a department to assign someone to, a position to put them in, a leave type to request
// against, a shipment to put in a trip, a loyalty program to earn points against, and — in the
// storefront — the ability to correct a mistyped address instead of deleting and retyping it.
//
// A mutation route without a form is invisible to every existing gate. Route-parity audits count
// UI -> backend calls, so an endpoint nothing calls looks clean. These tests assert the surface
// exists and that its payload matches the whitelisted DTO, because sending the whole response
// object is what a controller's forbidNonWhitelisted rejects.

const admin = {
  employeeMaster: read('apps/admin/app/modules/employee-master.tsx'),
  hrPayroll: read('apps/admin/app/modules/hr-payroll.tsx'),
  extensions: read('apps/admin/app/modules/extensions.tsx'),
  delivery: read('apps/admin/app/modules/delivery-lifecycle.tsx'),
};
const storefront = read('apps/storefront/app/page.tsx');
const hrDto = read('apps/api/src/hr/dto/hr.dto.ts');
const extensionsDto = read('apps/api/src/extensions/dto/extensions.dto.ts');
const storefrontDto = read('apps/api/src/storefront-customer/dto/storefront-customer.dto.ts');

test('department and position can be created from the employee master page', () => {
  // Both POSTs are gated employee.manage, the same permission the employee form itself needs,
  // and both are read back by the departmentId/positionId selects on that same page.
  assert.match(admin.employeeMaster, /api\(\s*'\/hr\/departments'\s*,\s*\{\s*method:\s*'POST'/);
  assert.match(admin.employeeMaster, /api\(\s*'\/hr\/positions'\s*,\s*\{\s*method:\s*'POST'/);
  // The form is hidden entirely without the permission, matching the employee form.
  assert.match(admin.employeeMaster, /\{canManageEmployees && <div className="grid2">/);

  // DTO: code and name required, parentId / departmentId / grade optional. companyId must NOT be
  // sent — the tenant comes from the token and the DTO only carries it for legacy callers.
  assert.match(hrDto, /class CreateDepartmentDto[\s\S]*code!: string;[\s\S]*name!: string;[\s\S]*parentId\?: string;/);
  assert.match(hrDto, /class CreatePositionDto[\s\S]*code!: string;[\s\S]*name!: string;[\s\S]*grade\?: string;/);
  const deptBody = admin.employeeMaster.slice(admin.employeeMaster.indexOf("api('/hr/departments'"));
  assert.doesNotMatch(deptBody.slice(0, deptBody.indexOf('})')), /companyId/, 'companyId must come from the token, not the form');
});

test('leave type can be created, and annualQuota is sent as a number', () => {
  assert.match(admin.hrPayroll, /api\('\/hr\/leave-types',\s*\{\s*method:\s*'POST'/);
  // @IsNumber() would reject the raw FormData string.
  assert.match(admin.hrPayroll, /annualQuota: fd\.get\('annualQuota'\) \? Number\(fd\.get\('annualQuota'\)\)/);
  assert.match(hrDto, /class CreateLeaveTypeDto[\s\S]*paid\?: boolean;[\s\S]*annualQuota\?: number;[\s\S]*requiresDocument\?: boolean;/);
  // The gate is leave.manage, distinct from leave.approve which gates the review buttons.
  assert.match(admin.hrPayroll, /disabled=\{!canAll\('leave\.manage'\) \|\| busy\}/);
});

test('loyalty program can be created, and every numeric field is coerced', () => {
  assert.match(admin.extensions, /writeJson\(`\$\{API\}\/loyalty\/programs`, token, 'POST'/);
  for (const field of ['earnRate', 'redemptionRate', 'minimumRedeem', 'pointsExpireDays']) {
    assert.match(admin.extensions, new RegExp(`${field}: fd\\.get\\('${field}'\\) \\? Number\\(`), `${field} must be a number for @IsNumber`);
  }
  assert.match(extensionsDto, /class CreateLoyaltyProgramDto[\s\S]*earnRate\?: number;[\s\S]*redemptionRate\?: number;[\s\S]*minimumRedeem\?: number;[\s\S]*pointsExpireDays\?: number;/);
  // @Permissions('loyalty.manage') AND @Roles(SUPER_ADMIN, OWNER, ADMIN). The two guards throw
  // independently, so the control needs the permission AND the role, not the permission alone.
  assert.match(admin.extensions, /const canManageLoyaltyPrograms = hasAnyRole\('SUPER_ADMIN', 'OWNER', 'ADMIN'\) && canAll\('loyalty\.manage'\)/);
  assert.match(admin.extensions, /\{canManageLoyaltyPrograms && <button disabled=\{busy\}>Tambah program<\/button>\}/);
});

test('shipment can be created, and recipient is the object shape the trip manifest reads back', () => {
  assert.match(admin.delivery, /api\('\/shipments',\{method:'POST'/);
  // recipient is @IsObject() stored as JSON. shipmentDefaults() reads name/phone/address, so any
  // other key set would render empty recipient rows in the trip manifest.
  assert.match(admin.delivery, /recipient:\{ name:shipmentForm\.name\.trim\(\), phone:shipmentForm\.phone\.trim\(\), address:shipmentForm\.address\.trim\(\) \}/);
  assert.match(extensionsDto, /class CreateShipmentDto[\s\S]*warehouseId!: string;[\s\S]*recipient!: Record<string, unknown>;/);
  assert.match(admin.delivery, /canAll\('shipment\.manage'\)/);
});

test('storefront address can be edited, not only created and deleted', () => {
  // The account page had POST and DELETE for addresses but no PATCH, so correcting a mistyped
  // street meant deleting the address and retyping all of it.
  assert.match(storefront, /method: editing \? 'PATCH' : 'POST'/);
  assert.match(storefront, /\/storefront\/account\/addresses\$\{editing \? `\/\$\{editing\}` : ''\}/);
  assert.match(storefront, /function editAddress\(/);
  // isDefault is create-only in the DTO, so sending it on PATCH would be a whitelisting error.
  assert.match(storefront, /body: JSON\.stringify\(editing \? addressForm : \{ \.\.\.addressForm, isDefault: addresses\.length === 0 \}\)/);
  // Deleting the row currently open in the form must close the form, or submit would PATCH a
  // row that no longer exists.
  assert.match(storefront, /if \(editingAddressId === id\) \{\s*setEditingAddressId\(null\)/);
});

test('storefront contact profile can be edited, and the payload is the whitelisted DTO', () => {
  // Scope to the saveProfile body. A bare /account/me`,\s*\{\s*method:'PATCH'/ search matches the
  // GET in loadAccount first — the same endpoint is both read and written, so an unscoped regex
  // asserts against the wrong occurrence and reports a false green.
  const start = storefront.indexOf('async function saveProfile');
  assert.ok(start > 0, 'saveProfile handler must exist');
  const body = storefront.slice(start, storefront.indexOf('async function saveAddress'));
  // The path is a template literal — `${API}/storefront/...` — so a pattern starting with
  // "api/storefront" can never match the real call, and the test would fail for a reason that
  // has nothing to do with the behaviour under test.
  assert.match(body, /\/storefront\/account\/me`,\s*\{\s*method:\s*'PATCH'/);
  // UpdateStorefrontProfileDto: name, email, phone, address. Sending the whole account object
  // would carry points and loyaltyTier, which the DTO does not own.
  assert.match(body, /name: profileForm\.name\.trim\(\) \|\| undefined,[\s\S]*email: profileForm\.email\.trim\(\) \|\| undefined,[\s\S]*phone: profileForm\.phone\.trim\(\) \|\| undefined,[\s\S]*address: profileForm\.address\.trim\(\) \|\| undefined,/);
  // The handler must refresh from the server afterwards, otherwise the page would keep showing
  // the pre-edit values even after a successful PATCH.
  assert.match(body, /await loadAccount\(accountToken\)/);
  assert.match(storefrontDto, /class UpdateStorefrontProfileDto[\s\S]*name\?: string;[\s\S]*email\?: string;[\s\S]*phone\?: string;[\s\S]*address\?: string;/);
});

test('commerce lifecycle controls mirror backend role+permission guards and refresh auth canonically', () => {
  assert.match(admin.extensions, /const canManagePayments = hasAnyRole\('SUPER_ADMIN', 'OWNER', 'ADMIN', 'FINANCE'\) && canAll\('payment\.manage'\)/);
  assert.match(admin.extensions, /const canManageShipments = hasAnyRole\('SUPER_ADMIN', 'OWNER', 'ADMIN', 'WAREHOUSE'\) && canAll\('shipment\.manage'\)/);
  assert.match(admin.extensions, /const canCancelOrders = hasAnyRole\('SUPER_ADMIN', 'OWNER', 'ADMIN', 'WAREHOUSE', 'FINANCE'\) && canAll\('order\.cancel'\)/);
  const action = admin.extensions.slice(admin.extensions.indexOf('async function orderAction'), admin.extensions.indexOf('const extensionMode'));
  assert.match(action, /authFetch\(`\$\{API\}\/orders\/\$\{order\.id\}\/\$\{action\}`, token,/);
  assert.doesNotMatch(action, /fetch\(/, 'order lifecycle actions must use authFetch so refresh-token recovery stays consistent');
});

test('the seven forms stay wired to their route, so a rename cannot silently orphan one', () => {
  // Each call site and its route, asserted together. A route rename in the controller would
  // break the form loudly here instead of leaving a button that 404s.
  const pairs = [
    [admin.employeeMaster, /'\/hr\/departments'/, 'POST'],
    [admin.employeeMaster, /'\/hr\/positions'/, 'POST'],
    [admin.hrPayroll, /'\/hr\/leave-types'/, 'POST'],
    [admin.extensions, /\/loyalty\/programs`, token, 'POST'/, 'POST'],
    [admin.delivery, /'\/shipments',\{method:'POST'/, 'POST'],
    // Scoped to the handler, same reason as above: the profile PATCH shares its path with the
    // account GET, so an unscoped pattern would match the read and pass even if the write vanished.
    [storefront.slice(storefront.indexOf('async function saveProfile')), /\/storefront\/account\/me`,\s*\{\s*method:\s*'PATCH'/, 'PATCH'],
    [storefront, /editing \? 'PATCH' : 'POST'/, 'PATCH'],
  ];
  for (const [source, pattern, method] of pairs) {
    assert.match(source, pattern, `missing ${method} call site`);
  }
  assert.equal(pairs.length, 7, 'all seven previously formless mutations must stay covered');
});
