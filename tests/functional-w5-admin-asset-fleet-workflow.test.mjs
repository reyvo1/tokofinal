import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const ui=fs.readFileSync(new URL('../apps/admin/app/modules/assets-fleet.tsx',import.meta.url),'utf8');
const assetController=fs.readFileSync(new URL('../apps/api/src/assets/assets.controller.ts',import.meta.url),'utf8');
const fleetController=fs.readFileSync(new URL('../apps/api/src/fleet/fleet.controller.ts',import.meta.url),'utf8');

test('asset lifecycle is executable from Admin rather than read-only',()=>{
 for(const s of ["'/assets/categories'","'/assets'","'/assets/maintenance'","'/assets/depreciation-runs'"]) assert.ok(ui.includes(s),`missing ${s}`);
 assert.match(ui,/\/assets\/maintenance\/\$\{completeMaintenanceId\}\/complete/);
 assert.match(ui,/Catat perolehan aset/); assert.match(ui,/Selesaikan & posting/); assert.match(ui,/Jalankan depresiasi/);
 assert.match(assetController,/Post\('depreciation-runs'\)/);
});

test('fleet vehicle and fuel workflows are executable from Admin',()=>{
 assert.ok(ui.includes("'/fleet/vehicles'")); assert.ok(ui.includes("'/fleet/fuel'"));
 assert.match(ui,/Nomor struk/); assert.match(ui,/Catat BBM/);
 assert.match(fleetController,/Post\('vehicles'\)/); assert.match(fleetController,/Post\('fuel'\)/);
});

test('Admin asset-fleet workflow avoids native prompt based operations',()=>{assert.doesNotMatch(ui,/prompt\(|window\.prompt/);});
