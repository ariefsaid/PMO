#!/usr/bin/env node
// Usage: node scripts/check-no-attribution.mjs <base-ref> [head-ref=HEAD] | --self-test
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PATTERN = new RegExp(['clau' + 'de', 'anthro' + 'pic', 'co-authored' + '-by', 'generated' + ' with'].join('|'), 'i');

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

export function findOffenders(base, head = 'HEAD', cwd = process.cwd()) {
  const hashes = git(['rev-list', `${base}..${head}`], cwd).split('\n').filter(Boolean);
  const offenders = [];
  for (const hash of hashes) {
    const [an, ae, cn, ce] = git(['show', '-s', '--format=%an%n%ae%n%cn%n%ce', hash], cwd).split('\n');
    const message = git(['show', '-s', '--format=%B', hash], cwd);
    const matched = [];
    for (const [label, value] of [['author name', an], ['author email', ae], ['committer name', cn], ['committer email', ce]]) {
      if (PATTERN.test(value)) matched.push(`${label}: ${value}`);
    }
    for (const line of message.split('\n')) if (PATTERN.test(line)) matched.push(`message line: ${line}`);
    if (matched.length) offenders.push({ hash, matched });
  }
  return offenders;
}

export function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'no-attribution-'));
  try {
    const ident = { GIT_AUTHOR_NAME: 'Dev', GIT_AUTHOR_EMAIL: 'dev@example.test', GIT_COMMITTER_NAME: 'Dev', GIT_COMMITTER_EMAIL: 'dev@example.test' };
    const commit = (message, env = {}) => {
      writeFileSync(join(dir, 'f.txt'), message);
      git(['add', 'f.txt'], dir);
      execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir, env: { ...process.env, ...ident, ...env } });
    };
    git(['init', '-q'], dir);
    commit('base');
    const base = git(['rev-parse', 'HEAD'], dir).trim();
    commit('clean change');
    if (findOffenders(base, 'HEAD', dir).length !== 0) throw new Error('clean commit was flagged');
    commit('bad change\n\nCo-Authored' + '-By: someone');
    const found = findOffenders(base, 'HEAD', dir);
    if (found.length !== 1) throw new Error(`expected 1 offender, got ${found.length}`);
    commit('another', { GIT_AUTHOR_EMAIL: 'noreply@anthro' + 'pic.com' });
    if (findOffenders(base, 'HEAD', dir).length !== 2) throw new Error('author email not flagged');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(argv) {
  if (argv[0] === '--self-test') {
    selfTest();
    console.log('check-no-attribution self-test passed');
    return 0;
  }
  if (!argv[0]) {
    console.error('usage: check-no-attribution.mjs <base-ref> [head-ref]');
    return 2;
  }
  const offenders = findOffenders(argv[0], argv[1]);
  for (const { hash, matched } of offenders) {
    console.error(hash);
    for (const m of matched) console.error(`  ${m}`);
  }
  if (offenders.length) {
    console.error(`${offenders.length} commit(s) carry attribution`);
    return 1;
  }
  console.log('no attribution found');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main(process.argv.slice(2)));
