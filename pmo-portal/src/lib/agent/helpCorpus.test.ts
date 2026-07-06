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

it('NFR-DH-SEC-003 help corpus contains no internal-only citations or data-row shapes', () => {
  expect(HELP_CORPUS).not.toMatch(/ADR-\d|OD-[A-Z]|NFR-|FR-DH|AC-DH|STRIDE|OWASP|\bRLS\b|\borg_id\b/);
  expect(HELP_CORPUS).not.toMatch(/\{"id":/);
});
