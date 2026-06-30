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
  // tasks is NOT in A1 entities (D5)
  expect(p).not.toContain('tasks');
});

it('includes allowed column names from ENTITY_WHITELIST for each entity', () => {
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
