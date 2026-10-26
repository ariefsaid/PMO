#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const detector = path.join(ROOT, '.claude/skills/impeccable/scripts/impeccable');
const sources = (process.env.SRC_DIRS || '').split(/\s+/).filter(Boolean);
if (!sources.length) process.exit(0);
if (!fs.existsSync(detector)) throw new Error(`Vendored detector missing: ${detector}; run scripts/vendor-skills.sh.`);

const area = (process.env.AREA || 'misc').replace(/[^a-zA-Z0-9_-]/g, '-');
const output = path.join(ROOT, 'docs/private/ux-shots', area);
fs.mkdirSync(output, { recursive: true });
const advisory = (item) => item?.advisory === true || item?.isAdvisory === true
  || item?.severity === 'advisory' || item?.category === 'advisory';
const findingsCount = (value) => {
  if (Array.isArray(value)) return value.filter((item) => !advisory(item)).length;
  if (!value || typeof value !== 'object') return 0;
  return Object.entries(value).reduce((sum, [key, item]) => sum + (key === 'advisories' ? 0 : findingsCount(item)), 0);
};
const advisoryCount = (value) => {
  if (Array.isArray(value)) return value.filter(advisory).length;
  if (!value || typeof value !== 'object') return 0;
  return Object.entries(value).reduce((sum, [key, item]) => sum + (
    key === 'advisories' && Array.isArray(item) ? item.length : advisoryCount(item)
  ), 0);
};
const slug = (value) => value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
let failed = false;

for (const source of sources) {
  const absolute = path.resolve(ROOT, source);
  if (!absolute.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(absolute)) {
    console.error(`Invalid SRC_DIRS path: ${source}`);
    failed = true;
    continue;
  }
  const result = spawnSync(detector, ['detect', '--json', absolute], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
  if (result.error) throw result.error;
  let json;
  try { json = JSON.parse(result.stdout); }
  catch { throw new Error(`Impeccable returned invalid JSON for ${source}: ${result.stderr || result.stdout}`); }
  fs.writeFileSync(path.join(output, `${slug(source)}.source.detector.json`), `${JSON.stringify(json, null, 2)}\n`);
  const findings = findingsCount(json);
  const advisories = advisoryCount(json);
  console.log(`${source}: impeccable findings=${findings}; advisory=${advisories}`);
  if (findings > 0) failed = true;
}

process.exitCode = failed ? 1 : 0;
