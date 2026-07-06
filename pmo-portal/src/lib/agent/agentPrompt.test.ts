/**
 * Tests for buildAgentSystemPrompt.
 * NFR-AR-SEC-005: system prompt contains only schema metadata, no data rows.
 * FR-AR-021: whitelisted entity/column names + row cap + deputy framing.
 */
import { it, expect } from 'vitest';
import { buildAgentSystemPrompt } from '../../../../supabase/functions/agent-chat/prompt';
import {
  AGENT_READ_ENTITIES,
  AGENT_READ_ROW_CAP,
} from '../../../../supabase/functions/agent-chat/actions';

it('injects only whitelisted entity/column names + the row cap + deputy framing, no data rows (FR-AR-021, NFR-AR-SEC-005)', () => {
  const p = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP);

  expect(p).toContain('projects');
  expect(p).toContain('companies');
  expect(p).toContain(String(AGENT_READ_ROW_CAP));
  // deputy framing — must say something about acting within what the user can see
  expect(p).toMatch(/cannot exceed|only within what (you|this user) can see/i);
  // Defect 2: the read scope is broadened beyond the original D5 projects/companies pair to the
  // full RLS-readable business set. The reused entities (tasks, incidents, contacts) AND the
  // agent-curated entities (procurements, milestones, timesheets) now appear as query_entity
  // entities by the entity-bullet format.
  expect(p).toContain('  - tasks\n    - table: tasks');
  expect(p).toContain('  - incidents\n    - table: incident_reports');
  expect(p).toContain('  - procurements\n    - table: procurements');
  expect(p).toContain('  - milestones\n    - table: project_milestones');
  expect(p).toContain('  - timesheets\n    - table: timesheets');
});

it('includes allowed column names for each entity (reused ENTITY_WHITELIST + agent-curated)', () => {
  const p = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP);
  // projects columns
  expect(p).toContain('name');
  expect(p).toContain('status');
  // companies columns
  expect(p).toContain('type');
});

it('never contains data rows or cell values (NFR-AR-SEC-005)', () => {
  const p = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP);
  // No JSON-like data blobs
  expect(p).not.toMatch(/\{"id":/);
  // Purely schema metadata — non-trivial prompt
  expect(p.length).toBeGreaterThan(50);
});

it('AC-DH-001 help corpus text is present in every system prompt (FR-DH-005)', () => {
  const p = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP);
  // a defined term + a role-scoped entry's screen reference prove the corpus is unconditionally appended
  expect(p).toContain('Committed spend');
  expect(p).toContain('/timesheets');
});

it('AC-DH-002 built prompt contains no data-row shapes and no interpolated org/user data (NFR-AR-SEC-005, NFR-DH-SEC-001)', () => {
  // role is the only per-request variable this feature folds in; pass one to prove it appears as a
  // word, not as a row/uuid.
  const p = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP, 'Engineer');
  expect(p).not.toMatch(/\{"id":/);
  expect(p).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i); // no org/user uuids interpolated
});

it('AC-DH-004 grounding-rule instruction text is present verbatim (FR-DH-008)', () => {
  const p = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP);
  expect(p).toMatch(/only.*(actions|affordances).*(role|permitted)/i);
});

it('AC-DH-003 caller role interpolated into prompt; null role omits the role sentence (FR-DH-007)', () => {
  const withRole = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP, 'Engineer');
  expect(withRole).toMatch(/The current user's role is Engineer/i);

  const noRole = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP, null);
  expect(noRole).not.toMatch(/The current user's role is/i);
  expect(noRole).not.toContain('null');
});
