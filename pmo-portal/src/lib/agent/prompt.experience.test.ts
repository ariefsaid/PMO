/**
 * prompt.experience.test.ts — Track B (agent-experience-layer, ADR-0050).
 *
 * Asserts the LAYERED system prompt: charter + tool index + progressively-disclosed
 * skills ("Use when…") + retained hard security rules, with the flat "respond in
 * plain text" line REMOVED and the tool index/skills gated by the registered tool set.
 *
 * Edge-fn unit via relative import (ADR-0039 §7 / REC-1 convention — Vitest root is
 * pmo-portal/, tests live here, not under supabase/functions/).
 *
 * Owning AC-AXP ids are the leading tokens of each it() title (ADR-0010 traceability).
 */
import { it, expect } from 'vitest';
import { buildAgentSystemPrompt } from '../../../../supabase/functions/agent-chat/prompt';

const ENTITIES = ['projects', 'companies'] as const;
const ROW_CAP = 50;
const ROLE = 'Engineer';

it('AC-AXP-007 prompt is layered, no "respond in plain text"', () => {
  const prompt = buildAgentSystemPrompt(ENTITIES as unknown as never, ROW_CAP, ROLE);

  // (a) Charter layer — a stable heading the rewrite introduces.
  expect(prompt).toMatch(/##\s*Charter|##\s*Purpose/i);

  // (b) Tool index — always-on tools each get an index line.
  expect(prompt).toMatch(/##\s*Tools/i);
  expect(prompt).toContain('query_entity');
  expect(prompt).toContain('ask_user');

  // (c) Skills — progressively disclosed, each with an explicit "Use when…" trigger.
  // At minimum the table + ask-user skills → "Use when" appears ≥ 2×.
  const useWhenCount = (prompt.match(/Use when/gi) ?? []).length;
  expect(useWhenCount).toBeGreaterThanOrEqual(2);

  // The flat plain-text chatbot instruction is REMOVED (ADR-0050 §1a).
  expect(prompt).not.toContain('respond in plain text');

  // Still pure metadata — no leaked data rows / sample values.
  expect(prompt).not.toMatch(/\{"id":/);
  expect(prompt).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
});

it('AC-AXP-008 prompt steers tabular to as:"table"', () => {
  const prompt = buildAgentSystemPrompt(ENTITIES as unknown as never, ROW_CAP, ROLE);

  // Uses the REAL field name `as` with value table (OBS-AXP-002), not `presentation`.
  expect(prompt).toMatch(/as["']?\s*[:=]\s*["']?table/i);

  // Tells the model NOT to hand-roll a markdown/pipe table for tabular data.
  expect(prompt).toMatch(/do not.*(markdown|pipe).*table/i);

  // Never advertises the wrong field name.
  expect(prompt).not.toMatch(/presentation.*table/i);
});

it('AC-AXP-009 prompt advertises only registered tools', () => {
  // Both gates OFF → gated tools/skills are not advertised (no dangling affordance), but the
  // ALWAYS-registered write actions (handler.ts BASE_ACTIONS: create_activity, update_task_status)
  // are still present regardless of the compose/automations gates.
  const off = buildAgentSystemPrompt(ENTITIES as unknown as never, ROW_CAP, ROLE, {
    composeEnabled: false,
    automationsEnabled: false,
  });
  expect(off).not.toContain('compose_view');
  expect(off).not.toContain('create_automation');
  expect(off).not.toContain('notify');
  expect(off).toContain('create_activity');
  expect(off).toContain('update_task_status');

  // Both gates ON → the compose + automation (+notify) skills ARE present, each with a trigger,
  // and the always-on write actions remain present too.
  const on = buildAgentSystemPrompt(ENTITIES as unknown as never, ROW_CAP, ROLE, {
    composeEnabled: true,
    automationsEnabled: true,
  });
  expect(on).toContain('compose_view');
  expect(on).toContain('create_automation');
  expect(on).toContain('notify');
  expect(on).toContain('create_activity');
  expect(on).toContain('update_task_status');
  // The conditional skills carry "Use when…" triggers too (progressive disclosure).
  const useWhenCountOn = (on.match(/Use when/gi) ?? []).length;
  expect(useWhenCountOn).toBeGreaterThanOrEqual(4);

  // Default opts (omitted) behave as both-off (DEC-4, non-breaking); always-on tools still present.
  const def = buildAgentSystemPrompt(ENTITIES as unknown as never, ROW_CAP, ROLE);
  expect(def).not.toContain('compose_view');
  expect(def).not.toContain('create_automation');
  expect(def).toContain('create_activity');
  expect(def).toContain('update_task_status');
});

it('AC-AXP-009 write actions (create_activity, update_task_status) route through the approve/deny chip', () => {
  const prompt = buildAgentSystemPrompt(ENTITIES as unknown as never, ROW_CAP, ROLE);
  expect(prompt).toMatch(/create_activity[\s\S]{0,400}approve\/deny|approve\/deny[\s\S]{0,200}create_activity/i);
  expect(prompt).toMatch(/write action/i);
});

it('AC-AXP-010 prompt retains hard security rules', () => {
  const prompt = buildAgentSystemPrompt(ENTITIES as unknown as never, ROW_CAP, ROLE);

  // Deputy / RLS read-only framing (cannot exceed the caller's access).
  expect(prompt).toMatch(/read-only/i);
  expect(prompt).toMatch(/cannot exceed|only within what (you|this user) can see/i);

  // FR-DH-007 role-grounding rule for help answers.
  expect(prompt).toMatch(/only.*(actions|affordances).*(role|permitted)/i);

  // No data rows in reasoning.
  expect(prompt).toMatch(/never include data rows/i);

  // Anti-fabrication + verify-before-done charter rules (ADR-0050 §1a).
  expect(prompt).toMatch(/never invent|do not invent|never fabricate/i);
  expect(prompt).toMatch(/verify|confirm.*(answer|result)/i);

  // Retained from the shipped prompt: role sentence, entity columns, row cap, help corpus.
  expect(prompt).toMatch(/The current user's role is Engineer/i);
  expect(prompt).toContain(String(ROW_CAP));
  expect(prompt).toContain('Committed spend'); // HELP_CORPUS still appended (FR-DH-005)
});

it('AC-AXP-009 ask-user skill is scoped to ambiguity and not over-triggered (FR-AXP-012/015)', () => {
  const prompt = buildAgentSystemPrompt(ENTITIES as unknown as never, ROW_CAP, ROLE);

  // Trigger scoped to genuine ambiguity.
  expect(prompt).toMatch(/ambiguous|underspecified|which one/i);

  // Anti-over-trigger guard (not a reflex before every answer / only on genuine ambiguity).
  expect(prompt).toMatch(/not.*before every|only when|genuinely|genuine ambiguity/i);

  // When no skill trigger matches, answer directly (closing rule).
  expect(prompt).toMatch(/answer directly|no (skill )?trigger matches/i);
});
