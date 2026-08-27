#!/usr/bin/env node
/**
 * check-promote-stamp — the promote gate's stamp says what it certified (#555).
 *
 * `scripts/verify-main-pr.sh` runs every local PR-to-main gate and then writes a stamp;
 * `.claude/hooks/pre-pr-main-gate.sh` refuses `gh pr create --base main` unless it matches. The two
 * halves are a CONTRACT, and until #555 they disagreed about what they were comparing: every check
 * runs against the WORKING TREE, while the stamp recorded HEAD's commit SHA.
 *
 * ⛔ WHAT THAT COST. A squash-merge into `dev` produces a new SHA with a BYTE-IDENTICAL tree, so the
 * stamp stopped matching and the gate had to run again — thirty minutes to certify content it had
 * already certified. Observed on the 2026-08-21 promote: gated `13673a68`, merged as `270813ae`,
 * both tree `84f0c12d`. The pressure that creates is the real hazard: a thirty-minute re-run for a
 * no-op is exactly the gate people learn to skip.
 *
 * This asserts the two halves still agree, because they live in different files and nothing else
 * couples them. Run with `--self-test` to prove it can fail.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITER = 'scripts/verify-main-pr.sh';
const READER = '.claude/hooks/pre-pr-main-gate.sh';
const STAMP = 'verify-main-pr-ok';

/** Both halves must resolve the same git object. `HEAD^{tree}`, not `HEAD`. */
const TREE_EXPR = /rev-parse\s+(['"])HEAD\^\{tree\}\1/;

export function analyse({ writer, reader }) {
  const problems = [];

  if (!writer.includes(STAMP)) problems.push(`${WRITER} no longer writes the ${STAMP} stamp at all.`);
  if (!reader.includes(STAMP)) problems.push(`${READER} no longer reads the ${STAMP} stamp — the gate is a sentence again.`);

  const writerLine = writer.split('\n').find((l) => l.includes(STAMP) && l.includes('rev-parse') && !l.trimStart().startsWith('#'));
  if (!writerLine) problems.push(`${WRITER}: could not find the line that computes the stamp.`);
  else if (!TREE_EXPR.test(writerLine)) {
    problems.push(`${WRITER} stamps something other than HEAD^{tree}: ${writerLine.trim()}`);
  }

  // The reader must COMPARE against a tree it resolved itself.
  if (!TREE_EXPR.test(reader)) {
    problems.push(`${READER} never resolves HEAD^{tree}, so it cannot be comparing what the gate tested.`);
  }
  if (/\[\s*"\$stamp"\s*=\s*"\$head"\s*\]\s*&&\s*exit 0/.test(reader)) {
    problems.push(`${READER} still short-circuits on a COMMIT match — a squash of identical content would be refused.`);
  }

  return problems;
}

function selfTest() {
  const writer = fs.readFileSync(path.join(ROOT, WRITER), 'utf8');
  const reader = fs.readFileSync(path.join(ROOT, READER), 'utf8');
  const cases = [];
  const check = (name, ok, detail) => cases.push({ name, ok, detail });

  check('the shipped pair passes — the control', analyse({ writer, reader }).length === 0, JSON.stringify(analyse({ writer, reader })));

  check(
    'a writer reverted to stamping the COMMIT fails',
    analyse({ writer: writer.replace(/rev-parse 'HEAD\^\{tree\}'/, 'rev-parse HEAD'), reader }).length > 0,
    '',
  );
  check(
    'a reader that stops resolving the tree fails',
    analyse({ writer, reader: reader.replace(/rev-parse 'HEAD\^\{tree\}'/, 'rev-parse HEAD') }).length > 0,
    '',
  );
  check(
    'a reader that short-circuits on a commit match fails',
    analyse({ writer, reader: reader + '\n[ "$stamp" = "$head" ] && exit 0\n' }).length > 0,
    '',
  );
  check(
    'a writer that stops stamping at all fails',
    analyse({ writer: writer.split('\n').filter((l) => !l.includes(STAMP)).join('\n'), reader }).length > 0,
    '',
  );
  check(
    'a reader that stops reading the stamp fails',
    analyse({ writer, reader: reader.split('\n').filter((l) => !l.includes(STAMP)).join('\n') }).length > 0,
    '',
  );

  for (const c of cases) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.ok || !c.detail ? '' : `  — ${c.detail}`}`);
  const failed = cases.filter((c) => !c.ok).length;
  if (failed) {
    console.error(`\n✗ self-test: ${failed}/${cases.length} failed. Do NOT trust a green run.`);
    return 1;
  }
  console.log(`✓ self-test: ${cases.length}/${cases.length} — the check reddens on every planted defect.`);
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  const problems = analyse({
    writer: fs.readFileSync(path.join(ROOT, WRITER), 'utf8'),
    reader: fs.readFileSync(path.join(ROOT, READER), 'utf8'),
  });
  if (problems.length) {
    console.error('\n✗ the promote gate and its hook disagree about what the stamp means:\n');
    for (const p of problems) console.error(`  ${p}`);
    console.error('\n#555: the gate tests the WORKING TREE, so the stamp must be HEAD^{tree}. A commit-keyed');
    console.error('stamp forces a 30-minute re-run after a squash that changed nothing — which is exactly');
    console.error('the pressure that teaches people to skip the gate.\n');
    process.exit(1);
  }
  console.log('✓ promote-stamp contract: writer and hook both key on HEAD^{tree}.');
}
