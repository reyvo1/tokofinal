import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readlinkSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const workspace = process.cwd();
const mode = process.argv[2] ?? "typecheck";
const requireFromWorkspace = createRequire(resolve(workspace, "package.json"));
const canonicalTsconfig = resolve(workspace, "tsconfig.json");
const productionTsconfig = resolve(workspace, "tsconfig.build.json");
const nextConfigPath = resolve(workspace, "next.config.mjs");

function fail(message) {
  console.error(`[next-workspace] ${message}`);
  process.exit(1);
}

function resolveTool(specifier, label) {
  try {
    return requireFromWorkspace.resolve(specifier);
  } catch (error) {
    console.error(`[next-workspace] ${label} tidak ditemukan dari ${workspace}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function runNodeTool(label, entrypoint, args, extraEnv = {}) {
  const result = spawnSync(process.execPath, [entrypoint, ...args], {
    cwd: workspace,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });

  if (result.error) fail(`${label} gagal dijalankan: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function captureNodeTool(label, entrypoint, args, extraEnv = {}) {
  const result = spawnSync(process.execPath, [entrypoint, ...args], {
    cwd: workspace,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
  });

  if (result.error) fail(`${label} gagal dijalankan: ${result.error.message}`);
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? "";
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "EPERM");
  }
}

function readLockPid(lockFile) {
  if (!existsSync(lockFile)) return null;
  try {
    const parsed = JSON.parse(readFileSync(lockFile, "utf8"));
    const pid = Number(parsed.pid);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function detectDevProcessFromProc() {
  if (process.platform !== "linux" || !existsSync("/proc")) return null;

  let entries = [];
  try {
    entries = readdirSync("/proc", { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const pid = Number(entry.name);
    if (!processExists(pid)) continue;
    try {
      const procCwd = readlinkSync(`/proc/${pid}/cwd`);
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
      const isNextDev = /(?:^|[\s/])next(?:-server)?(?:\s|$)/i.test(cmdline) && /(?:^|\s)dev(?:\s|$)/i.test(cmdline);
      if (procCwd === workspace && isNextDev) return pid;
    } catch {
      // Process may exit while /proc is inspected; continue safely.
    }
  }
  return null;
}

function assertNoActiveDev() {
  const lockCandidates = [
    resolve(workspace, ".next", "dev", "lock"),
    resolve(workspace, ".next", "lock"),
  ];
  for (const lockFile of lockCandidates) {
    const pid = readLockPid(lockFile);
    if (pid && processExists(pid)) {
      fail(`next dev masih aktif untuk workspace ini (PID=${pid}). Hentikan dev sebelum verification/build.`);
    }
  }

  const procPid = detectDevProcessFromProc();
  if (procPid) {
    fail(`next dev masih aktif untuk workspace ini (PID=${procPid}, terdeteksi via /proc). Hentikan dev sebelum verification/build.`);
  }
}

function resetGeneratedNextOutput() {
  const generatedPaths = [
    resolve(workspace, ".next"),
    resolve(workspace, "next-env.d.ts"),
    resolve(workspace, "tsconfig.tsbuildinfo"),
    resolve(workspace, "tsconfig.build.tsbuildinfo"),
  ];

  console.log("[next-workspace] remove generated Next/TypeScript artifacts before deterministic verification");
  for (const path of generatedPaths) {
    if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  }
}


function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function captureAuthorityHashes() {
  const required = [canonicalTsconfig, productionTsconfig, nextConfigPath];
  for (const path of required) {
    if (!existsSync(path)) fail(`configuration authority tidak ditemukan: ${path}`);
  }
  return new Map(required.map((path) => [path, sha256File(path)]));
}

function assertAuthorityHashesUnchanged(before) {
  for (const [path, expected] of before.entries()) {
    if (!existsSync(path)) fail(`configuration authority hilang saat verification: ${path}`);
    const actual = sha256File(path);
    if (actual !== expected) {
      fail(`Next/TypeScript mengubah configuration authority saat verification: ${path}`);
    }
  }
}

function assertResolvedNextMatchesWorkspace(nextPackagePath) {
  const workspacePackage = JSON.parse(readFileSync(resolve(workspace, "package.json"), "utf8"));
  const installedNext = JSON.parse(readFileSync(nextPackagePath, "utf8"));
  const declaredNext = workspacePackage.dependencies?.next;
  if (typeof declaredNext !== "string" || !/^\d+\.\d+\.\d+$/.test(declaredNext)) {
    fail("Next.js workspace dependency wajib exact semver agar verification reproducible.");
  }
  if (installedNext.version !== declaredNext) {
    fail(`Next.js runtime drift: installed=${installedNext.version} declared=${declaredNext}`);
  }
}

function assertBuildConfig() {
  if (!existsSync(canonicalTsconfig)) fail(`canonical tsconfig tidak ditemukan: ${canonicalTsconfig}`);
  if (!existsSync(productionTsconfig)) {
    fail(`build tsconfig tidak ditemukan: ${productionTsconfig}`);
  }
  if (!existsSync(nextConfigPath)) fail(`next.config.mjs tidak ditemukan: ${nextConfigPath}`);
  const config = JSON.parse(readFileSync(productionTsconfig, "utf8"));
  if (config.extends !== "./tsconfig.json") {
    fail("tsconfig.build.json wajib extends ./tsconfig.json agar compiler authority tidak bercabang.");
  }
  if (config.compilerOptions && Object.keys(config.compilerOptions).length > 0) {
    fail("tsconfig.build.json tidak boleh melemahkan/override compilerOptions canonical.");
  }
  const include = Array.isArray(config.include) ? config.include : [];
  const exclude = Array.isArray(config.exclude) ? config.exclude : [];
  if (include.some((entry) => String(entry).includes(".next/dev"))) {
    fail("tsconfig.build.json tidak boleh memasukkan .next/dev types.");
  }
  if (!include.includes(".next/types/**/*.ts")) {
    fail("tsconfig.build.json wajib memasukkan production .next/types.");
  }
  if (!exclude.includes(".next/dev/**/*")) {
    fail("tsconfig.build.json wajib mengecualikan .next/dev/**/* secara eksplisit.");
  }
}

function assertResolvedTypeScriptAuthority(tscBin) {
  const raw = captureNodeTool("tsc --showConfig", tscBin, ["--showConfig", "-p", "tsconfig.build.json"]);
  let resolved;
  try {
    resolved = JSON.parse(raw);
  } catch (error) {
    fail(`tsc --showConfig tidak menghasilkan JSON valid: ${error instanceof Error ? error.message : String(error)}`);
  }

  const files = Array.isArray(resolved.files) ? resolved.files.map((entry) => String(entry).replaceAll("\\", "/")) : [];
  if (files.some((entry) => entry.includes("/.next/dev/") || entry.includes(".next/dev/"))) {
    fail("resolved tsconfig.build.json masih mengonsumsi .next/dev generated types.");
  }
  if (!files.some((entry) => entry.endsWith("/.next/types/routes.d.ts") || entry === "./.next/types/routes.d.ts" || entry === ".next/types/routes.d.ts")) {
    fail("resolved tsconfig.build.json tidak mengonsumsi production .next/types/routes.d.ts.");
  }

  const options = resolved.compilerOptions ?? {};
  if (options.strict !== true) fail("resolved production TypeScript authority wajib strict=true.");
  if (options.noEmit !== true) fail("resolved production TypeScript authority wajib noEmit=true.");
  const moduleResolution = String(options.moduleResolution ?? "").toLowerCase();
  if (!moduleResolution.includes("bundler")) {
    fail(`resolved production TypeScript authority wajib moduleResolution=bundler, actual=${options.moduleResolution}`);
  }
  console.log(`[next-workspace] resolved production TypeScript authority PASS: ${files.length} files, strict/noEmit/bundler preserved`);
}

function assertProductionTypes() {
  const productionRoutes = resolve(workspace, ".next", "types", "routes.d.ts");
  if (!existsSync(productionRoutes)) {
    fail(`production route types tidak ditemukan: ${productionRoutes}`);
  }
  if (existsSync(resolve(workspace, ".next", "dev"))) {
    fail(".next/dev muncul pada deterministic production verification.");
  }

  const nextEnv = resolve(workspace, "next-env.d.ts");
  if (existsSync(nextEnv)) {
    const source = readFileSync(nextEnv, "utf8");
    if (source.includes(".next/dev/types")) {
      fail("next-env.d.ts masih menunjuk .next/dev/types setelah production generation.");
    }
  }
}

assertBuildConfig();
const authorityHashes = captureAuthorityHashes();

if (mode === "build-preflight") {
  assertNoActiveDev();
  console.log("[next-workspace] build preflight PASS: no active next dev writer");
  process.exit(0);
}

const nextBin = resolveTool("next/dist/bin/next", "Next.js CLI");
const nextPackage = resolve(nextBin, "..", "..", "..", "package.json");
if (!existsSync(nextPackage)) fail(`Next.js package metadata tidak ditemukan: ${nextPackage}`);
assertResolvedNextMatchesWorkspace(nextPackage);
assertNoActiveDev();
resetGeneratedNextOutput();

if (mode === "typecheck") {
  const tscBin = resolveTool("typescript/bin/tsc", "TypeScript CLI");
  console.log("[next-workspace] generate production route types with build tsconfig authority");
  runNodeTool("next typegen", nextBin, ["typegen"], { T360_NEXT_VERIFY: "1" });
  assertAuthorityHashesUnchanged(authorityHashes);
  assertProductionTypes();
  assertResolvedTypeScriptAuthority(tscBin);
  console.log("[next-workspace] run strict TypeScript check against tsconfig.build.json");
  runNodeTool("tsc", tscBin, ["--noEmit", "-p", "tsconfig.build.json"]);
  assertAuthorityHashesUnchanged(authorityHashes);
  assertProductionTypes();
  process.exit(0);
}

if (mode === "build") {
  const tscBin = resolveTool("typescript/bin/tsc", "TypeScript CLI");
  console.log("[next-workspace] run deterministic production Next build with build tsconfig authority");
  runNodeTool("next build", nextBin, ["build"], { T360_NEXT_VERIFY: "1" });
  assertAuthorityHashesUnchanged(authorityHashes);
  assertProductionTypes();
  assertResolvedTypeScriptAuthority(tscBin);
  process.exit(0);
}

fail(`mode tidak dikenal: ${mode}. Gunakan typecheck, build-preflight, atau build.`);
