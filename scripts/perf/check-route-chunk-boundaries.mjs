#!/usr/bin/env node

import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const distRoot = resolve(process.env.PMO_DIST_DIR ?? join(repoRoot, 'pmo-portal/dist'));
const manifestPath = join(distRoot, '.vite/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

function staticClosure(entryKey) {
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    const item = manifest[key];
    assert.ok(item, `manifest entry exists: ${key}`);
    seen.add(key);
    for (const imported of item.imports ?? []) visit(imported);
  };
  visit(entryKey);
  return [...seen];
}

function routeKeys(entryKey, selectedEntryKey) {
  return [...new Set([
    ...staticClosure(entryKey),
    ...(selectedEntryKey ? staticClosure(selectedEntryKey) : []),
  ])];
}

function routeMetrics(entryKey, selectedEntryKey) {
  const keys = routeKeys(entryKey, selectedEntryKey);
  const files = keys.map((key) => {
    const relativeFile = manifest[key].file;
    const bytes = readFileSync(join(distRoot, relativeFile));
    return { file: relativeFile, decodedBytes: bytes.byteLength, gzipBytes: gzipSync(bytes).byteLength };
  });
  const entry = manifest[entryKey];
  const entryBytes = readFileSync(join(distRoot, entry.file));
  return {
    entry: entry.file,
    entryDecodedBytes: entryBytes.byteLength,
    entryGzipBytes: gzipSync(entryBytes).byteLength,
    requestCount: files.length,
    decodedBytes: files.reduce((total, file) => total + file.decodedBytes, 0),
    gzipBytes: files.reduce((total, file) => total + file.gzipBytes, 0),
    ...(process.argv.includes('--list') ? { files } : {}),
  };
}

function findEntry(pattern) {
  return Object.keys(manifest).find((key) => pattern.test(`${key} ${manifest[key].name ?? ''} ${manifest[key].file}`));
}

const dashboardKey = 'pages/ExecutiveDashboard.tsx';
const administrationKey = 'pages/Administration.tsx';
const dashboard = manifest[dashboardKey];
const administration = manifest[administrationKey];
assert.ok(dashboard, `manifest entry exists: ${dashboardKey}`);
assert.ok(administration, `manifest entry exists: ${administrationKey}`);

const companyDashboardKey = findEntry(/CompanyDashboard/i);
const engineerDashboardKey = findEntry(/EngineerDashboard/i);
const pmDashboardKey = findEntry(/PMDashboard/i);
const integrationsKey = findEntry(/AdministrationIntegrationsPanel|IntegrationsPanel/i);
const usersPanelKey = findEntry(/AdministrationUsersPanel|UsersPanel/i);
const usageKey = findEntry(/AdministrationUsagePanel|UsagePanel/i);
const featuresKey = findEntry(/AdministrationFeaturesPanel|FeaturesPanel/i);
const accountingKey = findEntry(/AdministrationAccountingPanel|AccountingPanel/i);

const measurements = {
  '/ (Engineer role)': routeMetrics(dashboardKey, engineerDashboardKey),
  '/ (Executive role)': routeMetrics(dashboardKey, companyDashboardKey),
  '/administration/users': routeMetrics(administrationKey, usersPanelKey),
};
console.log(JSON.stringify(measurements, null, 2));

assert.ok(engineerDashboardKey, 'Engineer dashboard is emitted as a separate module chunk');
assert.ok(companyDashboardKey, 'Company dashboard is emitted as a separate module chunk');
assert.ok(pmDashboardKey, 'PM dashboard is emitted as a separate module chunk');
assert.ok((dashboard.dynamicImports ?? []).some((key) => key === engineerDashboardKey), 'Engineer dashboard is a dynamic import');
assert.ok((dashboard.dynamicImports ?? []).some((key) => key === companyDashboardKey), 'Company dashboard is a dynamic import');
assert.ok((dashboard.dynamicImports ?? []).some((key) => key === pmDashboardKey), 'PM dashboard is a dynamic import');

const companyRequests = staticClosure(companyDashboardKey).map((key) => manifest[key].file);
assert.ok(!companyRequests.some((file) => /vendor-recharts/i.test(file)), 'Company dashboard static request graph excludes the recharts vendor');
const engineerRequests = routeKeys(dashboardKey, engineerDashboardKey).map((key) => manifest[key].file);
assert.ok(!engineerRequests.includes(manifest[companyDashboardKey].file), 'Engineer route request graph excludes the company dashboard chunk');
assert.ok(!engineerRequests.includes(manifest[pmDashboardKey].file), 'Engineer route request graph excludes the PM dashboard chunk');

for (const [section, key] of Object.entries({ users: usersPanelKey, integrations: integrationsKey, usage: usageKey, features: featuresKey, accounting: accountingKey })) {
  assert.ok(key, `${section} Administration panel is emitted as a separate module chunk`);
  assert.ok((administration.dynamicImports ?? []).includes(key), `${section} Administration panel is a dynamic import`);
}

const administrationGzipLimit = 33_000;
assert.ok(
  measurements['/administration/users'].entryGzipBytes <= administrationGzipLimit,
  `Administration route chunk is <= ${administrationGzipLimit} gzip bytes (got ${measurements['/administration/users'].entryGzipBytes})`,
);

const usersRequests = routeKeys(administrationKey, usersPanelKey).map((key) => `${key} ${manifest[key].file}`);
assert.ok(!usersRequests.some((entry) => /IntegrationsView|AgentCostMetrics|AdministrationUsage/i.test(entry)), 'Users route static request graph excludes integrations and usage code');
