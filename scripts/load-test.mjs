#!/usr/bin/env node
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
import { assertRuntimeDatabaseTarget, expectedPostgresTarget } from './lib/runtime-target-identity.mjs';
import { writeFile } from 'node:fs/promises';
import { readAndVerifyBuildArtifactManifest } from './lib/build-artifact-identity.mjs';

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function numericArgument(name, fallback, { integer = false, min = -Infinity, max = Infinity } = {}) {
  const raw = argument(name, fallback);
  const value = Number(raw);
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) {
    const range = Number.isFinite(max) ? `${min}..${max}` : `>= ${min}`;
    console.error(`--${name} tidak valid: ${raw}. Harus ${integer ? 'bilangan bulat ' : 'angka '}${range}.`);
    process.exit(1);
  }
  return value;
}

const url = argument('url', 'http://127.0.0.1:4000/api/v1/health');
const total = numericArgument('requests', '500', { integer: true, min: 1 });
const concurrency = numericArgument('concurrency', '25', { integer: true, min: 1 });
const method = argument('method', 'GET').toUpperCase();
const token = argument('token', '');
const bodyText = argument('body', '');
const timeoutMs = numericArgument('timeout-ms', '10000', { integer: true, min: 100 });
const maxP95Ms = numericArgument('max-p95-ms', '0', { min: 0 });
const maxP99Ms = numericArgument('max-p99-ms', '0', { min: 0 });
const maxErrorRate = numericArgument('max-error-rate', '0', { min: 0, max: 1 });
const minRps = numericArgument('min-rps', '0', { min: 0 });
const output = argument('output', 'handoff/quality/load-health-latest.json');
const expectedRuntimeSource = argument('expected-source-fingerprint', '');
const expectedDbHost = argument('expected-db-host', '');
const expectedDbName = argument('expected-db-name', '');
let expectedBuildArtifactId = argument('expected-build-artifact-id', '');
if ((expectedDbHost && !expectedDbName) || (!expectedDbHost && expectedDbName)) {
  console.error('--expected-db-host dan --expected-db-name wajib diisi bersama.');
  process.exit(1);
}
const targetUrl = new URL(url);

let runtimeSourceFingerprint = null;
let runtimeBuildArtifactId = null;
let runtimeDatabaseTarget = null;
if (expectedRuntimeSource || expectedDbHost || expectedBuildArtifactId) {
  if (!/\/health\/?$/i.test(targetUrl.pathname)) {
    console.error('Runtime identity preflight hanya didukung untuk endpoint health.');
    process.exit(1);
  }
  try {
    if (!expectedBuildArtifactId) expectedBuildArtifactId = readAndVerifyBuildArtifactManifest(process.cwd(), 'handoff/quality/build-artifact-manifest-latest.json', expectedRuntimeSource || null).current.id;
    const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.json();
    if (!response.ok || body?.status !== 'ok') throw new Error(`health HTTP ${response.status}`);
    if (expectedRuntimeSource && body?.release?.sourceFingerprint !== expectedRuntimeSource) throw new Error(`runtime source fingerprint mismatch: ${body?.release?.sourceFingerprint || '<missing>'}`);
    if (expectedBuildArtifactId && body?.release?.buildArtifactId !== expectedBuildArtifactId) throw new Error(`runtime build artifact mismatch: ${body?.release?.buildArtifactId || '<missing>'}`);
    if (expectedDbHost) {
      const expectedDatabaseTarget = expectedPostgresTarget(expectedDbHost, expectedDbName);
      assertRuntimeDatabaseTarget(body?.release?.databaseTarget, expectedDatabaseTarget, 'Load runtime database target');
      runtimeDatabaseTarget = body.release.databaseTarget;
    }
    runtimeSourceFingerprint = body?.release?.sourceFingerprint || null;
    runtimeBuildArtifactId = body?.release?.buildArtifactId || null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = {
      generatedAt: new Date().toISOString(),
      sourceIdentity: sourceFingerprint(process.cwd()),
      runtimeSourceFingerprint: null,
      runtimeBuildArtifactId: null,
      runtimeDatabaseTarget: null,
      target: { hostHash: crypto.createHash('sha256').update(targetUrl.hostname).digest('hex').slice(0, 16), path: targetUrl.pathname },
      url, method, requests: total, concurrency, succeeded: 0, failed: 0, errorRate: null, requestsPerSecond: 0,
      latencyMs: null, statusCounts: {},
      preflight: { status: 'FAIL', error: message },
      thresholds: { maxP95Ms, maxP99Ms, maxErrorRate, minRps, passed: false, failures: [`runtime identity preflight: ${message}`] },
    };
    if (output) await writeFile(output, JSON.stringify(failed, null, 2) + '\n', 'utf8');
    console.error(`Runtime identity preflight gagal: ${message}`);
    process.exit(1);
  }
}

let next = 0;
let succeeded = 0;
let failed = 0;
const latencies = [];
const statusCounts = new Map();

async function execute() {
  while (true) {
    const current = next++;
    if (current >= total) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const started = performance.now();
    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(bodyText ? { 'Content-Type': 'application/json' } : {}),
        },
        body: bodyText || undefined,
      });
      await response.arrayBuffer();
      const elapsed = performance.now() - started;
      latencies.push(elapsed);
      statusCounts.set(response.status, (statusCounts.get(response.status) ?? 0) + 1);
      if (response.ok) succeeded += 1;
      else failed += 1;
    } catch {
      failed += 1;
      latencies.push(performance.now() - started);
      statusCounts.set('NETWORK_ERROR', (statusCounts.get('NETWORK_ERROR') ?? 0) + 1);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

const wallStart = performance.now();
await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => execute()));
const wallMs = performance.now() - wallStart;
const p95 = percentile(latencies, 0.95);
const p99 = percentile(latencies, 0.99);
const requestsPerSecond = total / (wallMs / 1000);
const errorRate = failed / total;
const thresholdFailures = [];
if (maxP95Ms > 0 && p95 > maxP95Ms) thresholdFailures.push(`p95 ${p95.toFixed(2)}ms > ${maxP95Ms}ms`);
if (maxP99Ms > 0 && p99 > maxP99Ms) thresholdFailures.push(`p99 ${p99.toFixed(2)}ms > ${maxP99Ms}ms`);
if (maxErrorRate >= 0 && errorRate > maxErrorRate) thresholdFailures.push(`errorRate ${(errorRate * 100).toFixed(2)}% > ${(maxErrorRate * 100).toFixed(2)}%`);
if (minRps > 0 && requestsPerSecond < minRps) thresholdFailures.push(`rps ${requestsPerSecond.toFixed(2)} < ${minRps}`);

const result = {
  generatedAt: new Date().toISOString(),
  sourceIdentity: sourceFingerprint(process.cwd()),
  runtimeSourceFingerprint,
  runtimeBuildArtifactId,
  runtimeDatabaseTarget,
  preflight: { status: expectedRuntimeSource || expectedDbHost || expectedBuildArtifactId ? 'PASS' : 'NOT_REQUESTED' },
  target: { hostHash: crypto.createHash('sha256').update(targetUrl.hostname).digest('hex').slice(0, 16), path: targetUrl.pathname },
  url,
  method,
  requests: total,
  concurrency,
  succeeded,
  failed,
  errorRate: Number(errorRate.toFixed(6)),
  requestsPerSecond: Number(requestsPerSecond.toFixed(2)),
  latencyMs: {
    min: Number(Math.min(...latencies).toFixed(2)),
    p50: Number(percentile(latencies, 0.5).toFixed(2)),
    p95: Number(p95.toFixed(2)),
    p99: Number(p99.toFixed(2)),
    max: Number(Math.max(...latencies).toFixed(2)),
  },
  statusCounts: Object.fromEntries(statusCounts),
  thresholds: { maxP95Ms, maxP99Ms, maxErrorRate, minRps, passed: thresholdFailures.length === 0, failures: thresholdFailures },
};
const rendered = JSON.stringify(result, null, 2) + '\n';
console.log(rendered.trimEnd());
if (output) await writeFile(output, rendered, 'utf8');
if (thresholdFailures.length) process.exitCode = 2;
