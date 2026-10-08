import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const apps = ["admin", "pos", "storefront", "employee-portal"];
const runner = resolve("scripts/typecheck-next-workspace.mjs");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function write(path, content) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function createSyntheticWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "t360-next-authority-"));
  write(join(root, "package.json"), '{"name":"synthetic-next-authority","private":true,"dependencies":{"next":"16.3.5"}}\n');
  write(
    join(root, "next.config.mjs"),
    'import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";\n' +
      'export default function nextConfig(phase){const isDev=phase===PHASE_DEVELOPMENT_SERVER;const verify=process.env.T360_NEXT_VERIFY==="1";return {typescript:{ignoreBuildErrors:false,tsconfigPath:isDev&&!verify?"tsconfig.json":"tsconfig.build.json"}};}\n',
  );
  write(join(root, "tsconfig.json"), '{"compilerOptions":{"strict":true},"include":["next-env.d.ts",".next/types/**/*.ts",".next/dev/types/**/*.ts","**/*.ts"]}\n');
  write(join(root, "tsconfig.build.json"), '{"extends":"./tsconfig.json","include":["next-env.d.ts",".next/types/**/*.ts","**/*.ts"],"exclude":["node_modules",".next/dev/**/*"]}\n');

  write(join(root, "node_modules/next/package.json"), '{"name":"next","version":"16.3.5","exports":{"./constants":"./constants.js","./constants.js":"./constants.js","./dist/bin/next":"./dist/bin/next"}}\n');
  write(
    join(root, "node_modules/next/dist/bin/next"),
    `import { existsSync, mkdirSync, writeFileSync } from "node:fs";\n` +
      `import { resolve } from "node:path";\n` +
      `const cmd=process.argv[2];\n` +
      `if (process.env.T360_SYNTH_MUTATE_AUTH === "1") writeFileSync(resolve("tsconfig.build.json"), "{}\\n");\n` +
      `if (existsSync(resolve(".next","dev"))) { console.error("STALE_DEV_TREE_VISIBLE"); process.exit(91); }\n` +
      `mkdirSync(resolve(".next","types"),{recursive:true});\n` +
      `writeFileSync(resolve(".next","types","routes.d.ts"),"export type Route = '/';\\n");\n` +
      `writeFileSync(resolve("next-env.d.ts"),'/// <reference types="next" />\\nimport "./.next/types/routes.d.ts";\\n');\n` +
      `if (cmd === "build") writeFileSync(resolve(".next","synthetic-build-pass"),"PASS\\n");\n` +
      `if (cmd === "typegen") writeFileSync(resolve(".next","synthetic-typegen-pass"),"PASS\\n");\n` +
      `process.exit(0);\n`,
  );
  write(join(root, "node_modules/next/constants.js"), 'export const PHASE_DEVELOPMENT_SERVER="phase-development-server";\n');

  write(join(root, "node_modules/typescript/package.json"), '{"name":"typescript","version":"5.9.3"}\n');
  write(
    join(root, "node_modules/typescript/bin/tsc"),
    `import { existsSync, writeFileSync } from "node:fs";\n` +
      `import { resolve } from "node:path";\n` +
      `if (existsSync(resolve(".next","dev"))) process.exit(92);\n` +
      `if (!existsSync(resolve(".next","types","routes.d.ts"))) process.exit(93);\n` +
      `if (!process.argv.includes("tsconfig.build.json")) process.exit(94);\n` +
      `if (process.argv.includes("--showConfig")) {\n` +
      `  process.stdout.write(JSON.stringify({compilerOptions:{strict:true,noEmit:true,moduleResolution:"bundler"},files:["./.next/types/routes.d.ts","./app/page.tsx"]}));\n` +
      `  process.exit(0);\n` +
      `}\n` +
      `writeFileSync(resolve(".next","synthetic-tsc-pass"),"PASS\\n");\n` +
      `process.exit(0);\n`,
  );

  return root;
}

test("all Next product apps use one deterministic typecheck/build runner", () => {
  for (const app of apps) {
    const pkg = readJson(`apps/${app}/package.json`);
    assert.equal(pkg.scripts.lint, "node ../../scripts/typecheck-next-workspace.mjs typecheck", `${app} lint`);
    assert.equal(pkg.scripts.build, "dotenv -e ../../.env -- node ../../scripts/typecheck-next-workspace.mjs build", `${app} build`);
  }
});

test("all Next products use phase-selected build tsconfig without weakening compiler options", () => {
  for (const app of apps) {
    const configPath = `apps/${app}/next.config.mjs`;
    assert.ok(existsSync(configPath), `${app} next.config.mjs`);
    const config = readFileSync(configPath, "utf8");
    assert.match(config, /from\s+["\']next\/constants\.js["\']/, `${app} uses Node ESM-safe Next constants import`);
    assert.match(config, /PHASE_DEVELOPMENT_SERVER/);
    // `experimental.isolatedDevBuild` was removed from Next.js itself, so carrying it only produced an
    // "Unrecognized key(s) in object" warning on every build while isolating nothing. The real dev/build
    // split in this repo is tsconfig.build.json excluding the dev tree, asserted below. The key must be
    // gone, and its absence is checked against the installed Next's own config schema so the assertion
    // cannot pass just because Next quietly reintroduced it.
    assert.doesNotMatch(config, /isolatedDevBuild/, `${app} must not carry the removed experimental.isolatedDevBuild key`);
    assert.match(config, /verificationOwnsTypes\s*=\s*process\.env\.T360_NEXT_VERIFY\s*===\s*"1"/);
    assert.match(config, /isDevelopmentServer\s*&&\s*!verificationOwnsTypes/);
    assert.match(config, /\?\s*"tsconfig\.json"\s*:\s*"tsconfig\.build\.json"/);
    assert.match(config, /tsconfigPath,/);
    assert.match(config, /ignoreBuildErrors:\s*false/);
    assert.doesNotMatch(config, /ignoreBuildErrors:\s*true/);

    const buildConfig = readJson(`apps/${app}/tsconfig.build.json`);
    assert.equal(buildConfig.extends, "./tsconfig.json");
    assert.equal(Object.hasOwn(buildConfig, "compilerOptions"), false, `${app} build config may not override compiler options`);
    assert.deepEqual(buildConfig.include, ["next-env.d.ts", ".next/types/**/*.ts", "**/*.ts", "**/*.tsx"]);
    assert.ok(buildConfig.exclude.includes(".next/dev/**/*"));
    assert.equal(buildConfig.include.some((entry) => entry.includes(".next/dev")), false);
    assert.equal(existsSync(`apps/${app}/tsconfig.typecheck.json`), false, `${app} obsolete V4.3 config removed`);
  }
});

test("shared Next runner rebuilds generated output and enforces production-only type authority", () => {
  const source = readFileSync("scripts/typecheck-next-workspace.mjs", "utf8");
  assert.match(source, /const productionTsconfig = resolve\(workspace, "tsconfig\.build\.json"\)/);
  assert.match(source, /next\/dist\/bin\/next/);
  assert.match(source, /typescript\/bin\/tsc/);
  assert.match(source, /detectDevProcessFromProc/);
  assert.match(source, /next dev masih aktif/);
  assert.match(source, /next-env\.d\.ts/);
  assert.match(source, /tsconfig\.build\.tsbuildinfo/);
  assert.match(source, /rmSync\(path, \{ recursive: true, force: true \}\)/);
  assert.match(source, /captureAuthorityHashes/);
  assert.match(source, /assertAuthorityHashesUnchanged/);
  assert.match(source, /Next\.js runtime drift/);
  assert.match(source, /extends !== "\.\/tsconfig\.json"/);
  assert.match(source, /tidak boleh melemahkan\/override compilerOptions canonical/);
  assert.match(source, /runNodeTool\("next typegen", nextBin, \["typegen"\]/);
  assert.match(source, /captureNodeTool\("tsc --showConfig", tscBin, \["--showConfig", "-p", "tsconfig\.build\.json"\]\)/);
  assert.match(source, /resolved tsconfig\.build\.json masih mengonsumsi \.next\/dev generated types/);
  assert.match(source, /resolved production TypeScript authority wajib strict=true/);
  assert.match(source, /resolved production TypeScript authority wajib noEmit=true/);
  assert.match(source, /moduleResolution=bundler/);
  assert.match(source, /runNodeTool\("tsc", tscBin, \["--noEmit", "-p", "tsconfig\.build\.json"\]\)/);
  assert.match(source, /runNodeTool\("next build", nextBin, \["build"\]/);
  assert.match(source, /next-env\.d\.ts masih menunjuk \.next\/dev\/types/);
  assert.doesNotMatch(source, /ignoreBuildErrors/);
});

test("verification authority is immutable and Next runtime must match exact workspace dependency", () => {
  const source = readFileSync("scripts/typecheck-next-workspace.mjs", "utf8");
  assert.match(source, /captureAuthorityHashes/);
  assert.match(source, /assertAuthorityHashesUnchanged/);
  assert.match(source, /Next\.js runtime drift/);
  assert.match(source, /\^\\d\+\\.\\d\+\\.\\d\+\$/);

  for (const app of apps) {
    const pkg = readJson(`apps/${app}/package.json`);
    assert.match(pkg.dependencies.next, /^\d+\.\d+\.\d+$/, `${app} Next dependency must be exact`);
  }
});

test("Next config keeps dev on canonical tsconfig but verification forces production tsconfig", () => {
  const root = createSyntheticWorkspace();
  try {
    const probe = `import cfg from './next.config.mjs';\n` +
      `const dev=cfg('phase-development-server').typescript.tsconfigPath;\n` +
      `process.env.T360_NEXT_VERIFY='1';\n` +
      `const verify=cfg('phase-development-server').typescript.tsconfigPath;\n` +
      `delete process.env.T360_NEXT_VERIFY;\n` +
      `const build=cfg('phase-production-build').typescript.tsconfigPath;\n` +
      `process.stdout.write(JSON.stringify({dev,verify,build}));\n`;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", probe], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout), {
      dev: "tsconfig.json",
      verify: "tsconfig.build.json",
      build: "tsconfig.build.json",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the removed experimental.isolatedDevBuild key stays out, and Next itself has dropped it", () => {
  // A source-only assertion can rot silently: if Next ever reintroduces the key, this test would still
  // demand it be absent and would be wrong rather than right. Read the installed Next's own config
  // schema so the gate tracks the framework instead of a memory of it.
  const nextVersion = readJson("node_modules/next/package.json").version;
  const schema = readFileSync("node_modules/next/dist/server/config-schema.js", "utf8");
  assert.ok(schema.length > 0, "Next config schema must be readable, otherwise this test proves nothing");
  assert.doesNotMatch(schema, /isolatedDevBuild/, `next@${nextVersion} still declares isolatedDevBuild; this gate must be revisited`);
});

test("P5 V4 machine contract locks phase-isolated generated-type authority", () => {
  const contract = readJson("config/p5-v4-total-ui-rebuild.json");
  const infra = contract.verificationInfrastructure;
  assert.equal(infra.nextGeneratedTypeAuthority, "phase-isolated-dev-and-production-types");
  // The isolation is carried by tsconfig.build.json excluding the dev tree, not by a framework flag
  // Next removed. The flag's name is retained only as an explicit "this is not the mechanism" record.
  assert.equal(infra.isolatedDevBuild, false);
  assert.equal(infra.cleanGeneratedOutputBeforeTypecheckAndBuild, true);
  assert.equal(infra.concurrentNextDevAndVerificationAllowed, false);
  assert.equal(infra.ignoreBuildErrorsAllowed, false);
  assert.equal(infra.canonicalCompilerOptionsAuthority, "tsconfig.json");
  assert.equal(infra.productionTsconfigPath, "tsconfig.build.json");
  assert.equal(infra.productionTsconfigExtendsCanonical, true);
  assert.equal(infra.productionDevTypesExcluded, true);
  assert.equal(infra.nextConfigPhaseSelectsTsconfig, true);
  assert.equal(infra.verificationEnvForcesProductionTsconfig, true);
  assert.equal(infra.generatedNextEnvResetBeforeVerification, true);
  assert.equal(infra.generatedTsBuildInfoResetBeforeVerification, true);
  assert.equal(infra.configurationAuthorityImmutableDuringVerification, true);
  assert.equal(infra.exactNextWorkspaceVersionRequired, true);
  assert.equal(infra.productionGeneratedTypesMustExcludeDevTree, true);
  assert.equal(infra.resolvedProductionTsconfigInspected, true);
  assert.equal(infra.resolvedProductionCompilerStrictNoEmitBundlerRequired, true);
  assert.equal(infra.generatedFilesPatchedAllowed, false);
});

test("runner removes malformed stale dev tree before synthetic production typecheck and build", () => {
  const root = createSyntheticWorkspace();
  try {
    write(join(root, ".next/dev/types/routes.d.ts"), "export type Broken = ;\n}\n");
    write(join(root, "next-env.d.ts"), 'import "./.next/dev/types/routes.d.ts";\n');
    write(join(root, "tsconfig.build.tsbuildinfo"), "stale-build-info\n");
    let result = spawnSync(process.execPath, [runner, "typecheck"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(join(root, ".next/dev")), false);
    assert.ok(existsSync(join(root, ".next/types/routes.d.ts")));
    assert.ok(existsSync(join(root, ".next/synthetic-typegen-pass")));
    assert.ok(existsSync(join(root, ".next/synthetic-tsc-pass")));
    assert.equal(existsSync(join(root, "tsconfig.build.tsbuildinfo")), false);
    assert.doesNotMatch(readFileSync(join(root, "next-env.d.ts"), "utf8"), /\.next\/dev\/types/);

    write(join(root, ".next/dev/types/validator.ts"), "const malformed = ;\n");
    write(join(root, "next-env.d.ts"), 'import "./.next/dev/types/validator.ts";\n');
    result = spawnSync(process.execPath, [runner, "build"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(join(root, ".next/dev")), false);
    assert.ok(existsSync(join(root, ".next/types/routes.d.ts")));
    assert.ok(existsSync(join(root, ".next/synthetic-build-pass")));
    assert.doesNotMatch(readFileSync(join(root, "next-env.d.ts"), "utf8"), /\.next\/dev\/types/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runner fails closed if Next mutates verification configuration authority", () => {
  const root = createSyntheticWorkspace();
  try {
    const result = spawnSync(process.execPath, [runner, "build"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, T360_SYNTH_MUTATE_AUTH: "1" },
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /mengubah configuration authority/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runner fails closed when a live dev lock is present", () => {
  const root = createSyntheticWorkspace();
  try {
    write(join(root, ".next/dev/lock"), JSON.stringify({ pid: process.pid, port: 3003 }) + "\n");
    const result = spawnSync(process.execPath, [runner, "build-preflight"], { cwd: root, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /next dev masih aktif/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
