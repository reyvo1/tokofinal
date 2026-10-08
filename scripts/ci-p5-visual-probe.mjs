#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';

const root = process.cwd();
const browserPath = path.join(root, 'handoff/quality/browser-uat-latest.json');
const mapPath = path.join(root, 'config/p5-visual-surface-map.json');
const v4Path = path.join(root, 'config/p5-v4-total-ui-rebuild.json');
const output = path.join(root, 'handoff/quality/github-p5-visual-rebuild-probe-latest.json');

if (!fs.existsSync(browserPath)) throw new Error(`P5 browser evidence tidak ditemukan: ${browserPath}`);
const browser = JSON.parse(fs.readFileSync(browserPath, 'utf8'));
const visualMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const v4 = JSON.parse(fs.readFileSync(v4Path, 'utf8'));
const current = sourceFingerprint(root);
const evidenceFingerprint = browser?.sourceIdentity?.value || browser?.runtimeSourceFingerprint || null;

if (v4.phase !== 'P5-V4' || v4.decision?.deliveryBoundary !== 'ONE_P5_FULL_V4_TOTAL_PRESENTATION_REBUILD') {
  throw new Error('P5 V4 canonical visual contract tidak aktif.');
}
if (v4.decision?.businessLogicChangesAllowed !== false || v4.decision?.apiContractChangesAllowed !== false || v4.decision?.permissionContractChangesAllowed !== false) {
  throw new Error('P5 V4 business/API/permission freeze contract hilang.');
}
if (v4.decision?.humanAcceptanceRequired !== true) throw new Error('P5 V4 human acceptance gate hilang.');

if (browser.status !== 'PASS') throw new Error(`P5 browser UAT belum PASS: ${browser.status}`);
if (!evidenceFingerprint || evidenceFingerprint !== current.value) {
  throw new Error(`P5 browser evidence stale. current=${current.value} evidence=${evidenceFingerprint || '<missing>'}`);
}

const checks = new Map((browser.checks || []).map((check) => [check.id, check]));
const matrix = checks.get('P5_VISUAL_SCREENSHOT_MATRIX');
if (!matrix || matrix.status !== 'PASS') throw new Error('P5 visual screenshot matrix belum PASS.');

const requiredCounts = {
  adminPrimary: visualMap.admin.primaryWorkspaces.length,
  adminContextual: visualMap.admin.representativeContextualRoutes.length,
  pos: visualMap.pos.views.length,
  storefront: visualMap.storefront.views.length,
  employeePortal: visualMap.employeePortal.views.length,
};
for (const [key, expected] of Object.entries(requiredCounts)) {
  const actual = Number(matrix.counts?.[key] ?? -1);
  if (actual !== expected) throw new Error(`P5 screenshot count ${key} invalid: ${actual}/${expected}`);
}

function requireScreenshots(rows, label) {
  if (!Array.isArray(rows) || !rows.length) throw new Error(`P5 ${label} screenshot rows kosong.`);
  for (const row of rows) {
    if (!String(row?.screenshot || '').startsWith('logs/browser-uat/p5-')) {
      throw new Error(`P5 ${label} screenshot path invalid: ${JSON.stringify(row)}`);
    }
  }
}
requireScreenshots(matrix.admin?.primary, 'Admin primary');
requireScreenshots(matrix.admin?.contextual, 'Admin contextual');
requireScreenshots(matrix.pos, 'POS');
requireScreenshots(matrix.storefront, 'Storefront');
requireScreenshots(matrix.employeePortal, 'Employee Portal');

for (const id of ['ADMIN_RESPONSIVE_SHELL','STOREFRONT_NAVIGATION_RUNTIME','POS_ALL_WORKSPACES_RUNTIME','EMPLOYEE_ALL_SELF_SERVICE_ROUTES']) {
  const check = checks.get(id);
  if (!check || check.status !== 'PASS') throw new Error(`P5 responsive prerequisite belum PASS: ${id}`);
  if (!Array.isArray(check.matrix) || check.matrix.length !== 3) throw new Error(`P5 responsive matrix invalid: ${id}`);
  for (const row of check.matrix) {
    if (![1440,1024,390].includes(row.width) || row.scrollWidth > row.width + 3) {
      throw new Error(`P5 responsive row invalid ${id}: ${JSON.stringify(row)}`);
    }
  }
}

const adminGeometry = checks.get('ADMIN_SHELL_GEOMETRY');
if (!adminGeometry || adminGeometry.status !== 'PASS' || !Array.isArray(adminGeometry.matrix) || adminGeometry.matrix.length !== 3) {
  throw new Error('P5 Admin shell geometry belum PASS.');
}
for (const row of adminGeometry.matrix) {
  if (![1440,1024,390].includes(row.width) || !row.main || !row.content || !row.sidebar) {
    throw new Error(`P5 Admin shell geometry row invalid: ${JSON.stringify(row)}`);
  }
  // Bandingkan terhadap lebar yang benar-benar TERSEDIA untuk konten, bukan ukuran viewport
  // yang diminta. Scrollbar vertical memakan 15px dari 1440, jadi main yang benar adalah
  // 1425 - sidebar 246 = 1179px. Versi lama menghitung ekspektasi dari `width` (1440),
  // sehingga main yang benar selalu terlihat menyusut dan check ini mustahil pernah lulus di
  // halaman yang benar pun - bug yang sudah dibetulkan di browser-uat.mjs tapi belum di probe
  // ini. Gate di sini jadi lebih ketat, bukan lebih longgar: main WAJIB juga menempel penuh
  // ke tepi kanan layout dan content tidak boleh menyusut, dua hal yang tadinya sama sekali
  // tidak diperiksa.
  const availableWidth = row.availableWidth ?? row.width;
  const tolerance = 4;
  if (row.width >= 1024) {
    if (!row.sidebarVisible || Math.abs(row.main.left - row.sidebar.right) > tolerance) {
      throw new Error(`P5 Admin desktop shell geometry invalid: ${JSON.stringify(row)}`);
    }
    if (row.main.width < availableWidth - row.sidebar.width - tolerance * 2) {
      throw new Error(`P5 Admin desktop main workspace menyusut: ${JSON.stringify(row)}`);
    }
    if (Math.abs(row.main.right - row.layout.right) > tolerance) {
      throw new Error(`P5 Admin desktop main tidak menempel ke tepi kanan layout: ${JSON.stringify(row)}`);
    }
    if (row.content.width < row.main.width - 96) {
      throw new Error(`P5 Admin desktop content terlalu sempit terhadap main workspace: ${JSON.stringify(row)}`);
    }
  } else {
    if (row.sidebarVisible || Math.abs(row.main.left - row.layout.left) > tolerance || Math.abs(row.main.width - availableWidth) > tolerance) {
      throw new Error(`P5 Admin mobile shell geometry invalid: ${JSON.stringify(row)}`);
    }
    if (row.content.width < availableWidth - 40) {
      throw new Error(`P5 Admin mobile content terlalu sempit: ${JSON.stringify(row)}`);
    }
  }
}

for (const id of ['P5_V4_ADMIN_VISUAL_IDENTITY','P5_V4_POS_VISUAL_IDENTITY','P5_V4_STOREFRONT_VISUAL_IDENTITY','P5_V4_EMPLOYEE_VISUAL_IDENTITY']) {
  const check = checks.get(id);
  if (!check || check.status !== 'PASS' || check.metrics?.generation !== 'p5-v4' || check.metrics?.version !== 'p5-v4') {
    throw new Error(`P5 V4 runtime visual identity belum PASS: ${id}`);
  }
  if (Number(check.metrics?.rootLuminance) < 190) throw new Error(`P5 V4 root masih legacy-dark: ${id}`);
}
const adminIdentity = checks.get('P5_V4_ADMIN_VISUAL_IDENTITY');
if (Number(adminIdentity?.metrics?.sidebarLuminance) < 190) throw new Error('P5 V4.6 Admin default sidebar harus terang sesuai reference dashboard.');
const adminTheme = checks.get('ADMIN_THEME_LIGHT_DARK');
if (!adminTheme || adminTheme.status !== 'PASS' || adminTheme.themes?.restored !== 'light' || adminTheme.themes?.light?.theme !== 'light' || adminTheme.themes?.dark?.theme !== 'dark') throw new Error('P5 V4.6 Admin light/dark theme contract belum PASS.');
const adminDashboard = checks.get('ADMIN_REFERENCE_DASHBOARD');
const requiredAdminPanels = ['sales-performance','top-revenue-drivers','product-performance','recent-activity','stock-watchlist','quick-actions'];
if (!adminDashboard || adminDashboard.status !== 'PASS' || adminDashboard.metricCount !== 6 || adminDashboard.title !== 'Dashboard Overview' || !requiredAdminPanels.every((panel)=>adminDashboard.panels?.includes(panel)) || !['line','donut'].every((kind)=>adminDashboard.charts?.includes(kind))) throw new Error('P5 V4.6 Admin reference dashboard runtime contract belum PASS.');

const result = {
  generatedAt: new Date().toISOString(),
  status: 'PASS',
  sourceIdentity: current,
  baseline: visualMap.baseline,
  checks: {
    exactSourceBrowserEvidence: true,
    adminPrimaryVisuals: requiredCounts.adminPrimary === matrix.admin.primary.length,
    adminContextualVisuals: requiredCounts.adminContextual === matrix.admin.contextual.length,
    posVisuals: requiredCounts.pos === matrix.pos.length,
    storefrontVisuals: requiredCounts.storefront === matrix.storefront.length,
    employeePortalVisuals: requiredCounts.employeePortal === matrix.employeePortal.length,
    responsiveDesktopTabletMobile: true,
    adminShellSemanticGeometry: adminGeometry.status === 'PASS',
    browserRuntimeExceptions: checks.get('BROWSER_RUNTIME_EXCEPTIONS')?.status === 'PASS',
    p5V4TotalPresentationRebuildContract: v4.phase === 'P5-V4' && v4.decision.tailwindUtilityFirstRequired === true,
    distinctRuntimeProductIdentity: ['P5_V4_ADMIN_VISUAL_IDENTITY','P5_V4_POS_VISUAL_IDENTITY','P5_V4_STOREFRONT_VISUAL_IDENTITY','P5_V4_EMPLOYEE_VISUAL_IDENTITY'].every((id) => checks.get(id)?.status === 'PASS'),
    adminReferenceDashboard: adminDashboard.status === 'PASS',
    adminLightDarkTheme: adminTheme.status === 'PASS',
    businessApiAuthorityFrozen: v4.decision.businessLogicChangesAllowed === false && v4.decision.apiContractChangesAllowed === false && v4.decision.permissionContractChangesAllowed === false,
  },
  screenshotCounts: requiredCounts,
  visualGeneration: 'P5-V4',
  visualContract: {
    deliveryBoundary: v4.decision.deliveryBoundary,
    productThemes: Object.fromEntries(Object.entries(v4.products).map(([key, value]) => [key, value.theme])),
    humanAcceptanceRequired: true,
  },
  humanAcceptance: 'PENDING',
  productionTouched: false,
  note: 'P5 V4.6 exact-source automated evidence proves the reference-aligned Admin dashboard, light default sidebar plus persisted dark mode, four distinct runtime product identities, page-level screenshot matrix, semantic Admin geometry, and desktop/tablet/mobile integrity. Business/API/permission authority remains frozen and Human UI acceptance remains mandatory.',
};
if (!Object.values(result.checks).every(Boolean)) throw new Error(`P5 checks incomplete: ${JSON.stringify(result.checks)}`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
