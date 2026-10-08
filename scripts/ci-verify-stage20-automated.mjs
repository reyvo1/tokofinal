#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
import { readAndVerifyBuildArtifactManifest } from './lib/build-artifact-identity.mjs';
import { REQUIRED_UAT_IDS } from './ci-prepare-github-simulation.mjs';

const root = process.cwd();
const file = path.join(root, 'logs', 'stage20-release-readiness', 'latest.json');
if (!fs.existsSync(file)) throw new Error('Stage-20 evidence tidak ditemukan.');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const source = sourceFingerprint(root);
const artifact = readAndVerifyBuildArtifactManifest(root, 'handoff/quality/build-artifact-manifest-latest.json', source.value).current;
const pending = Array.isArray(data?.uat?.pending) ? data.uat.pending : [];
const actualIds = Array.isArray(data?.uat?.scenarios) ? data.uat.scenarios.map((item) => item.id) : [];

if (data?.sourceIdentity?.value !== source.value) throw new Error('Stage-20 CI evidence source fingerprint mismatch.');
if (data?.buildArtifactId !== artifact.id) throw new Error('Stage-20 CI evidence build artifact mismatch.');
if (data?.gate?.automatedPassed !== true) throw new Error('Stage-20 automated gate belum PASS.');
if (data?.gate?.uatPassed !== false || data?.gate?.passed !== false) throw new Error('Stage-20 CI simulation wajib menyisakan human UAT sebagai PENDING, bukan mengklaim release PASS.');
if (pending.length !== REQUIRED_UAT_IDS.length || !REQUIRED_UAT_IDS.every((id) => pending.includes(id))) throw new Error('Stage-20 CI simulation harus menyisakan tepat 12 skenario human UAT pending.');
if (actualIds.length !== REQUIRED_UAT_IDS.length || !REQUIRED_UAT_IDS.every((id) => actualIds.includes(id))) throw new Error('Stage-20 CI evidence tidak memuat tepat 12 skenario wajib.');
console.log(`Stage-20 automated CI PASS; human UAT tetap PENDING ${pending.length}/${REQUIRED_UAT_IDS.length}; artifact ${artifact.id}.`);
