#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { canonicalTestIdentity, normalizePlaywrightList } from './browser-test-sharding.mjs';

const SHARD_COUNT = 3;

function check(full, shards, results = null) {
  const issues = [];
  if (shards.length !== SHARD_COUNT) return ['EXPECTED_SHARD_COUNT'];
  for (const shard of shards) {
    if (full.configDigest !== shard.configDigest) issues.push('CONFIG_DIGEST_MISMATCH');
    if (full.revision !== shard.revision) issues.push('REVISION_MISMATCH');
  }
  const expected = full.tests.filter((entry) => entry.project === 'chromium');
  const actual = shards.flatMap((shard) => shard.tests.filter((entry) => entry.project === 'chromium'));
  const keys = actual.map((entry) => canonicalTestIdentity({ mode: 'ordinary', ...entry }));
  const expectedKeys = expected.map((entry) => canonicalTestIdentity({ mode: 'ordinary', ...entry }));
  if (new Set(keys).size !== keys.length) issues.push('DUPLICATE_TEST');
  if (expected.length === 0 || shards.some((shard) => !shard.tests.some((entry) => entry.project === 'chromium'))) issues.push('EMPTY_SHARD');
  for (const key of expectedKeys) if (!keys.includes(key)) issues.push('MISSING_TEST');
  for (const key of keys) if (!expectedKeys.includes(key)) issues.push('EXTRA_TEST');
  if (results) {
    for (let index = 0; index < SHARD_COUNT; index += 1) {
      const expectedResultIds = shards[index].tests.map((entry) => canonicalTestIdentity({ mode: 'ordinary', ...entry })).sort();
      const actualResultIds = results[index].tests.map((entry) => canonicalTestIdentity({ mode: 'ordinary', ...entry })).sort();
      if (new Set(actualResultIds).size !== actualResultIds.length) issues.push('DUPLICATE_RESULT');
      if (JSON.stringify(actualResultIds) !== JSON.stringify(expectedResultIds)) issues.push('RESULT_INVENTORY_MISMATCH');
    }
  }
  return [...new Set(issues)].sort();
}

async function main(args) {
  if (args[0] === '--self-test') {
    const entry = (title) => ({ project: 'chromium', file: 'e2e/example.spec.ts', titlePath: [title], repeatIndex: 0 });
    const inv = (tests, invocation, overrides = {}) => ({ revision: overrides.revision ?? 'a'.repeat(40), configDigest: overrides.configDigest ?? 'b'.repeat(64), tests, invocation });
    const full = inv([entry('A'), entry('B'), entry('C')], 'full');
    const shards = [inv([entry('A')], 'one'), inv([entry('B')], 'two'), inv([entry('C')], 'three')];
    if (check(full, shards).length) throw new Error('valid three-shard partition rejected');
    if (!check(full, shards.slice(0, 2)).includes('EXPECTED_SHARD_COUNT')) throw new Error('two-shard partition accepted');
    if (!check(full, [inv([entry('A')], 'one'), inv([entry('A')], 'two'), inv([entry('C')], 'three')]).includes('DUPLICATE_TEST')) throw new Error('duplicate partition accepted');
    if (!check(full, [shards[0], shards[1], inv([entry('C')], 'three', { revision: 'c'.repeat(40) })]).includes('REVISION_MISMATCH')) throw new Error('third-shard revision drift accepted');
    if (!check(full, [shards[0], shards[1], inv([entry('C')], 'three', { configDigest: 'd'.repeat(64) })]).includes('CONFIG_DIGEST_MISMATCH')) throw new Error('third-shard config drift accepted');
    if (!check(full, shards, [inv([entry('A')], 'result-one'), inv([], 'result-two'), inv([entry('C')], 'result-three')]).includes('RESULT_INVENTORY_MISMATCH')) throw new Error('missing result accepted');
    console.log('check-browser-shard-inventory self-test OK');
    return 0;
  }
  if (args.length !== 2 + SHARD_COUNT * 2 || args[0] !== '--full') {
    console.error('usage: check-browser-shard-inventory.mjs --full full.json shard-1.json shard-2.json shard-3.json result-1.json result-2.json result-3.json | --self-test');
    return 2;
  }
  try {
    const provenance = JSON.parse(process.env.PLAYWRIGHT_CONFIG_PROVENANCE);
    const revision = process.env.GITHUB_SHA;
    const read = async (file, invocation, shard) => normalizePlaywrightList({
      report: JSON.parse(await readFile(file, 'utf8')), mode: 'ordinary', revision, invocation, selectedConfig: provenance,
    });
    const full = await read(args[1], 'chromium-full');
    const shards = [];
    const results = [];
    for (let index = 0; index < SHARD_COUNT; index += 1) {
      const shard = index + 1;
      shards.push(await read(args[2 + index], `chromium-${shard}`));
      results.push(await read(args[2 + SHARD_COUNT + index], `chromium-result-${shard}`));
    }
    const issues = check(full, shards, results);
    console.log(JSON.stringify({ schemaVersion: 1, revision, complete: issues.length === 0, expected: full.tests.length, selected: shards.reduce((n, shard) => n + shard.tests.length, 0), issueCodes: issues }));
    return issues.length ? 1 : 0;
  } catch (error) {
    const issueCodes = error.issues?.map((item) => item.code) ?? ['INVALID_INVENTORY'];
    console.log(JSON.stringify({ schemaVersion: 1, complete: false, issueCodes: [...new Set(issueCodes)].sort() }));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((status) => { process.exitCode = status; }).catch(() => { process.exitCode = 1; });
}
