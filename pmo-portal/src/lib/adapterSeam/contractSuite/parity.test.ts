/**
 * AC-ECA-040..042 (FR-ECA-050/051/052) — the parity gate: every registered ERP tier declares every
 * workflow, at the current behaviour version, and a "supported" claim has a shared suite behind it.
 */
import { describe, expect, it } from 'vitest';
import { WORKFLOWS, type TierWorkflows } from '../connect/workflows.ts';
import { ERPNEXT_WORKFLOWS } from '../erpnext/workflowDeclarations.ts';
import { SUITES } from './index.ts';
import { parityProblems } from './parity.ts';
import { TIER_WORKFLOWS } from './tiers.ts';

describe('AC-ECA-042 registered tiers are in parity with the registry', () => {
  it('has no problems today', () => {
    expect(parityProblems(TIER_WORKFLOWS, WORKFLOWS, SUITES)).toEqual([]);
  });
  it('registers ERPNext', () => {
    expect(TIER_WORKFLOWS.erpnext).toBe(ERPNEXT_WORKFLOWS);
  });
});

describe('AC-ECA-041 a stale version pin fails the parity test, naming tier and workflow', () => {
  it('flags a tier that pins the old version after a bump', () => {
    const bumped = { ...WORKFLOWS, 'party.match': { ...WORKFLOWS['party.match'], version: WORKFLOWS['party.match'].version + 1 } };
    const problems = parityProblems(TIER_WORKFLOWS, bumped, SUITES);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/erpnext/);
    expect(problems[0]).toMatch(/party\.match/);
  });
  it('accepts a tier that re-declares the bumped workflow as unavailable or pending against the new version', () => {
    const bumped = { ...WORKFLOWS, 'party.match': { ...WORKFLOWS['party.match'], version: 2 } };
    const tier = { ...ERPNEXT_WORKFLOWS, 'party.match': { status: 'unavailable', version: 2, reason: 'synthetic limitation' } } as TierWorkflows;
    expect(parityProblems({ synthetic: tier }, bumped, SUITES)).toEqual([]);
    const pending = { ...ERPNEXT_WORKFLOWS, 'party.match': { status: 'pending', version: 2, issue: 1604 } } as TierWorkflows;
    expect(parityProblems({ synthetic: pending }, bumped, SUITES)).toEqual([]);
  });
});

describe('declaration hygiene', () => {
  it('flags a supported workflow that has no shared suite', () => {
    const tier = { ...ERPNEXT_WORKFLOWS, 'census': { status: 'supported', version: WORKFLOWS['census'].version } } as TierWorkflows;
    expect(parityProblems({ synthetic: tier }, WORKFLOWS, SUITES).join('\n')).toMatch(/census.*no shared suite/);
  });
  it('flags an unavailable declaration without a reason and a pending one without an issue', () => {
    const tier = {
      ...ERPNEXT_WORKFLOWS,
      'census': { status: 'unavailable', version: WORKFLOWS['census'].version, reason: ' ' },
      'item.match': { status: 'pending', version: WORKFLOWS['item.match'].version, issue: 0 },
    } as TierWorkflows;
    const text = parityProblems({ synthetic: tier }, WORKFLOWS, SUITES).join('\n');
    expect(text).toMatch(/census.*reason/);
    expect(text).toMatch(/item\.match.*issue/);
  });
  it('flags a missing declaration at runtime too (a cast past the type)', () => {
    const { 'party.match': _omitted, ...rest } = ERPNEXT_WORKFLOWS;
    expect(parityProblems({ synthetic: rest as unknown as TierWorkflows }, WORKFLOWS, SUITES).join('\n')).toMatch(/party\.match.*no declaration/);
  });
});

describe('AC-ECA-040 a workflow added to the registry breaks typecheck until every tier declares it', () => {
  it('rejects a tier map with a missing key (the directive fails typecheck if the type stops requiring it)', () => {
    const { 'party.match': _omitted, ...rest } = ERPNEXT_WORKFLOWS;
    // @ts-expect-error a TierWorkflows without every registered workflow must not compile
    const incomplete: TierWorkflows = rest;
    expect(Object.keys(incomplete)).not.toContain('party.match');
  });
  it('rejects an unregistered workflow id', () => {
    // @ts-expect-error an id outside the registry must not compile
    const extra: TierWorkflows = { ...ERPNEXT_WORKFLOWS, 'made.up': { status: 'supported', version: 1 } };
    expect(extra).toBeDefined();
  });
});
