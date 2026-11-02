/**
 * T-37 (issue #1569) glossary-language binding — docs/glossary.md is the canonical domain
 * vocabulary; these assertions pin the project/delivery language corrections so the glossary
 * cannot silently drift back to the stale claims the audit called out. This is the lowest
 * sufficient layer: the findings are documentation-language corrections, and their consumers
 * (assistant corpus, locale copy) carry their own behavior tests.
 *
 * Mirrors the phaseVocabulary.test.ts pattern of reading source-of-truth copy at test time.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const glossary = readFileSync(join(process.cwd(), '../docs/glossary.md'), 'utf8').replace(/\s+/g, ' ');

describe('T-37 project & delivery language (docs/glossary.md)', () => {
  it('XD1-004 the Task entry states project optionality, subtasks and rollup semantics', () => {
    expect(glossary).toMatch(/may belong to a project or to no project/);
    expect(glossary).toMatch(/[Ss]ubtask/);
    expect(glossary).toMatch(/[Oo]nly top-level, non-archived tasks/);
    expect(glossary).toMatch(/OD-INT-9/);
    expect(glossary).not.toMatch(/Belongs to a project;/);
    expect(glossary).not.toMatch(/two levels only/);
  });

  it('XD1-004 the Milestone entry derives progress from top-level tasks', () => {
    expect(glossary).toMatch(/derived from its top-level tasks/);
  });

  it('XD2-006 sole operator means the sole active org member, distinct from the platform Operator', () => {
    expect(glossary).toMatch(/\*\*Sole operator\*\*/);
    expect(glossary).toMatch(/single active member of an organisation/);
    expect(glossary).toMatch(/not the platform \*\*Operator\*\*/i);
    expect(glossary).toMatch(/Activated by sole member/);
  });

  it('XD2-007 Entity is disambiguated from the generic code sense and the bidding_entity participation mode', () => {
    expect(glossary).toMatch(/bidding_entity/);
    expect(glossary).toMatch(/participation mode/);
    expect(glossary).toMatch(/"entity" names any persisted record/);
    // The glossary must not assert a shipped Entity relation on projects.
    expect(glossary).not.toMatch(/e\.g\. a project belongs to an Entity/);
    expect(glossary).toMatch(/not a shipped column/);
  });

  it('XD3-001 capability, configured assignment, project binding and the PMO-SoT push posture are distinct', () => {
    expect(glossary).toMatch(/configured assignment/);
    expect(glossary).toMatch(/project binding/);
    expect(glossary).toMatch(/PMO-SoT push posture/);
    expect(glossary).toMatch(/[Cc]apability is an upper bound/);
    expect(glossary).toMatch(/does not by itself flip ownership/);
    expect(glossary).toMatch(/timesheets and budgets even though it pushes them/);
  });

  it('XD3-002 the two mirror directions are named with ownership', () => {
    expect(glossary).toMatch(/external-SoT read-model/);
    expect(glossary).toMatch(/external-side mirror/);
    expect(glossary).toMatch(/push-state mirror/);
    expect(glossary).toMatch(/timesheet_erp_mirror/);
    expect(glossary).toMatch(/PMO owns the data/);
  });

  it('XD4-006 project, CRM and collaboration terms are defined', () => {
    for (const term of [
      '**Project** —', '**Pipeline stage** —', '**Notification** —', '**Contact** —',
      '**CRM activity** —', '**Meeting** —', '**Meeting attendee** —',
      '**Meeting access grant** —', '**Comment** —',
    ]) expect(glossary).toContain(term);
  });

  it('XD4-007 resource, HSE and reference-data terms are defined', () => {
    for (const term of [
      '**User profile** —', '**Spend approver** —', '**Task dependency** —',
      '**Timesheet** —', '**Timesheet entry** —', '**Incident report** —', '**Exchange rate** —',
    ]) expect(glossary).toContain(term);
  });
});
