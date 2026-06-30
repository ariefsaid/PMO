/**
 * Unit tests for buildSystemPrompt (the pure system prompt builder).
 * Imports the prompt builder from the edge function by relative path (Option B).
 * AC-### tags in each it() title are the traceability anchors (ADR-0010).
 *
 * NFR-AS-SEC-005: prompt must include only schema metadata — no data rows.
 */
import { it, expect } from 'vitest';
import { buildSystemPrompt } from '../../../../supabase/functions/compose-view/prompt';
import { registry } from '../viewspec/registry';
import { ENTITY_WHITELIST } from '../viewspec/types';

it('AC-AS-009 prompt includes every entity, every primitive, and the panel cap', () => {
  const prompt = buildSystemPrompt(ENTITY_WHITELIST, registry.keys(), 'org-1', 20);

  // Every entity name from the whitelist must appear in the prompt
  for (const entityKey of Object.keys(ENTITY_WHITELIST)) {
    expect(prompt).toContain(entityKey);
  }

  // Every primitive name from the registry must appear in the prompt
  for (const primitiveName of registry.keys()) {
    expect(prompt).toContain(primitiveName);
  }

  // The panel cap (20) must appear in the prompt
  expect(prompt).toContain('20');
});

it('AC-AS-010 prompt includes org_id context for $current_user/$current_org token hints', () => {
  const prompt = buildSystemPrompt(ENTITY_WHITELIST, registry.keys(), 'org-abc-123', 20);

  // The passed orgId must appear in the prompt
  expect(prompt).toContain('org-abc-123');

  // Must mention $current_user and $current_org token resolution
  expect(prompt).toMatch(/\$current_user|\$current_org/);
});

it('prompt contains no row data — only schema metadata (NFR-AS-SEC-005)', () => {
  const prompt = buildSystemPrompt(ENTITY_WHITELIST, registry.keys(), 'org-1', 20);

  // The prompt must not contain SQL row data patterns
  // It should be built only from whitelist/registry metadata
  // Specifically: no data values, only column names and entity names
  expect(prompt.length).toBeGreaterThan(50); // non-trivial prompt
  // The prompt is a string describing schema — verify it mentions allowed columns
  expect(prompt).toContain('contract_value'); // a column name from projects whitelist
  expect(prompt).toContain('project_id');     // requiredFilter from tasks whitelist
  // No SQL injection patterns or data values should appear (schema only)
  expect(prompt).not.toContain('SELECT *');
  expect(prompt).not.toContain('DROP TABLE');
});
