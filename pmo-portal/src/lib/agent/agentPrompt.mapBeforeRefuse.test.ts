/**
 * Defect 3 — prompt must steer the model to MAP a question to an available entity and query it
 * BEFORE claiming data "isn't available", instead of refusing outright. Only refuse when nothing
 * genuinely maps. Deputy/RLS framing stays intact; HELP_CORPUS is untouched (stays ≤ its cap).
 */
import { it, expect } from 'vitest';
import { buildAgentSystemPrompt } from '../../../../supabase/functions/agent-chat/prompt';
import { AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP } from '../../../../supabase/functions/agent-chat/readEntities';

it('Defect-3 prompt tells the model to map a question to an available entity before refusing', () => {
  const p = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP, 'Project Manager');
  // Core steering: before refusing, check whether the ask maps to an available entity and query it.
  expect(p).toMatch(/before (you )?(refuse|say|claim).*not available|map.*to an? (available )?entit/i);
  // Only refuse when nothing genuinely maps.
  expect(p).toMatch(/only refuse|refuse only|do not refuse/i);
  expect(p).toMatch(/nothing (genuinely )?(maps|maps)/i);
});

it('Defect-3 prompt carries the explicit opportunities/pipeline/deals → projects example', () => {
  const p = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP);
  // The umbrella sales words a user actually says…
  expect(p).toMatch(/opportunities|pipeline|deals/i);
  // …map to the projects entity, filtered by its REAL status column to the open/early stages.
  expect(p).toMatch(/projects/i);
  expect(p).toMatch(/status/i);
  // Must name a real early-stage project_status value (not invent one) — anti-fabrication.
  expect(p).toMatch(/Leads|Negotiation|Quotation|Tender/i);
});

it('Defect-3 prompt steers "how many X" to a query + count rather than a refusal', () => {
  const p = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP);
  expect(p).toMatch(/how many/i);
  expect(p).toMatch(/count|query_entity/i);
});

it('Defect-3 keeps the deputy/RLS framing intact (no privilege widening from the new guidance)', () => {
  const p = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP);
  expect(p).toMatch(/cannot exceed|only within what (you|this user) can see/i);
  expect(p).toMatch(/RLS/i);
  // The map-before-refuse guidance must not promise data beyond the caller's reach.
  expect(p).toMatch(/caller|this user/i);
});

// ── Live-loop regression (2026-07-07): the comma-in-enum-label footgun ───────────────
// The real `project_status` enum has a single label "Won, Pending KoM" that CONTAINS a comma.
// The prompt previously listed the on-hand statuses as ["Won","Pending KoM","Ongoing Project"] —
// splitting that one label into two invalid values. The model used them verbatim → Postgres
// 22P02 → the "how many active projects" run died. Lock the corrected value in.
it('prompt on-hand project statuses use the exact comma-containing enum label (not a mis-split)', () => {
  const p = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP);
  // The single, comma-containing enum label must appear verbatim…
  expect(p).toContain('Won, Pending KoM');
  // …and the broken split ("Won" immediately followed by a separate "Pending KoM" value) must not.
  expect(p).not.toMatch(/"Won"\s*,\s*"Pending KoM"/);
  // And the model must be explicitly told these values are opaque — never split on the comma.
  expect(p).toMatch(/never split|copy .*exactly|single (enum )?(value|label)/i);
});
