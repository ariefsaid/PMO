/**
 * Fixture guard for the deputy-help-desk corpus (spec docs/specs/deputy-help.spec.md).
 * NFR-DH-PERF-001: corpus size is bounded + measured at authoring time (≤6000 chars ≈ ≤1500 tokens
 * at the spec's 4 chars/token rate). NFR-DH-SEC-003: no internal-only citations leak into user copy.
 */
import { it, expect } from 'vitest';
import { HELP_CORPUS } from '../../../../supabase/functions/agent-chat/helpCorpus';

it('NFR-DH-PERF-001 help corpus is non-empty and within the 6000-char / 1500-token ceiling', () => {
  expect(HELP_CORPUS.length).toBeGreaterThan(0);
  expect(HELP_CORPUS.length).toBeLessThanOrEqual(6000);
});

it('help corpus contains the load-bearing anchors (term + role-scoped screen)', () => {
  expect(HELP_CORPUS).toContain('Committed spend');
  expect(HELP_CORPUS).toContain('/timesheets');
  expect(HELP_CORPUS).toContain('/approvals');
  expect(HELP_CORPUS).toContain('/procurement/:id');
  expect(HELP_CORPUS).toContain('Project Manager');
  expect(HELP_CORPUS).toContain('Engineer');
});

it('XD1-004 task model: a task may be project-less, may carry subtasks, and only top-level non-archived tasks roll up', () => {
  expect(HELP_CORPUS).toMatch(/may belong to a project or stand alone/);
  expect(HELP_CORPUS).toMatch(/may carry subtasks/);
  expect(HELP_CORPUS).toMatch(/only top-level, non-archived tasks count toward progress/);
});

it('XD1-007/DD-VOCAB-1 the corpus speaks Phase and maps it to the internal milestone term', () => {
  expect(HELP_CORPUS).toMatch(/\*\*Phase\*\* — a named chunk of delivery work/);
  expect(HELP_CORPUS).toMatch(/called a milestone in some internal documents/);
  expect(HELP_CORPUS).toContain('How do I create or edit a phase?');
  expect(HELP_CORPUS).not.toContain('How do I create or edit a milestone?');
});

it('gives grounded document source, revision, and verification guidance', () => {
  expect(HELP_CORPUS).toMatch(/PMO-held upload/);
  expect(HELP_CORPUS).toMatch(/linked Microsoft 365 file/);
  expect(HELP_CORPUS).toMatch(/no source yet/);
  expect(HELP_CORPUS).toMatch(/one source at most/);
  expect(HELP_CORPUS).toMatch(/folder.*reference-only/);
  expect(HELP_CORPUS).toMatch(/not an issuable or approvable file/);
  expect(HELP_CORPUS).toMatch(/issue-time baseline/);
  expect(HELP_CORPUS).toMatch(/Changed, Unchanged, or Not verified/);
  expect(HELP_CORPUS).toMatch(/rename is not content drift/);
  expect(HELP_CORPUS).toMatch(/immediate predecessor/);
  expect(HELP_CORPUS).toMatch(/Issued or Approved/);
  expect(HELP_CORPUS).toMatch(/Closed predecessor and earlier ancestors keep their status/);
});

it('NFR-DH-SEC-003 help corpus contains no internal-only citations or data-row shapes', () => {
  expect(HELP_CORPUS).not.toMatch(/ADR-\d|OD-[A-Z]|NFR-|FR-DH|AC-DH|STRIDE|OWASP|\bRLS\b|\borg_id\b/);
  expect(HELP_CORPUS).not.toMatch(/\{"id":/);
});

it('T-36 (#1568): money language states the shipped committed/actual basis, never the retired definitions', () => {
  // Committed spend is per-currency open commitment; a ledger-reading org nets out held amounts (XD1-001/XD2-001).
  expect(HELP_CORPUS).toMatch(/open purchase commitment/);
  expect(HELP_CORPUS).toMatch(/own currencies/);
  expect(HELP_CORPUS).toMatch(/minus what the ledger already holds/);
  // Actual follows the one-figure rule: ledger cost when read, else the proxy — never "the same number".
  expect(HELP_CORPUS).toMatch(/Recorded spending/);
  expect(HELP_CORPUS).not.toMatch(/the same number as Committed spend/);
  expect(HELP_CORPUS).not.toMatch(/No separate actuals ledger exists today/);
  // Contract on hand is unearned contract value, per currency — no "revenue on hand" tile claim (XD1-002/XD1-009).
  expect(HELP_CORPUS).toMatch(/Contract on hand/);
  expect(HELP_CORPUS).toMatch(/not earned revenue/);
  expect(HELP_CORPUS).not.toMatch(/revenue on hand/);
  // The case is optionally project-linked and the purchase alias is recorded (XD2-002/XD2-003).
  expect(HELP_CORPUS).toMatch(/an optional project/);
  expect(HELP_CORPUS).toMatch(/calls it a purchase/);
});
