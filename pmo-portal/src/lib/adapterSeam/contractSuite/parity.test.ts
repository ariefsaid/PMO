/**
 * AC-ECA-040..042 (FR-ECA-050/051/052) — the parity gate: every registered ERP tier declares every
 * workflow, at the current behaviour version, and a "supported" claim has a shared suite behind it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WORKFLOWS, type TierWorkflows } from '../connect/workflows.ts';
import { ERPNEXT_WORKFLOWS } from '../erpnext/workflowDeclarations.ts';
import { ODOO_WORKFLOWS } from '../odoo/workflowDeclarations.ts';
import { SUITES } from './index.ts';
import { parityProblems, suiteRunProblems, tierRegistrationProblems } from './parity.ts';
import { TIER_HARNESSES, TIER_WORKFLOWS } from './tiers.ts';

describe('AC-ECA-042 registered tiers are in parity with the registry', () => {
  it('has no problems today', () => {
    expect(parityProblems(TIER_WORKFLOWS, WORKFLOWS, SUITES)).toEqual([]);
  });
  it('registers ERPNext', () => {
    expect(TIER_WORKFLOWS.erpnext).toBe(ERPNEXT_WORKFLOWS);
  });
  it('AC-ODC-095 registers Odoo', () => {
    expect(TIER_WORKFLOWS.odoo).toBe(ODOO_WORKFLOWS);
  });
});

const SEAM = new URL('../', import.meta.url).pathname;
const tiersOnDisk = readdirSync(SEAM, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(`${SEAM}${e.name}/workflowDeclarations.ts`))
  .map((e) => e.name);

describe('AC-ECA-042 a tier cannot skip the gate by not registering', () => {
  it('every adapterSeam/<tier>/workflowDeclarations.ts is registered, with declarations and a harness', () => {
    expect(tiersOnDisk.length).toBeGreaterThan(0);
    expect(tierRegistrationProblems(tiersOnDisk, Object.keys(TIER_WORKFLOWS), Object.keys(TIER_HARNESSES))).toEqual([]);
  });
  it('flags a tier that has declarations on disk but is not registered', () => {
    expect(tierRegistrationProblems(['erpnext', 'odoo'], ['erpnext'], ['erpnext']).join('\n')).toMatch(/odoo.*not in TIER_WORKFLOWS/);
  });
  it('flags a registered tier with no declarations file or no harness', () => {
    const text = tierRegistrationProblems(['erpnext'], ['erpnext', 'odoo'], ['erpnext']).join('\n');
    expect(text).toMatch(/odoo.*no workflowDeclarations\.ts/);
    expect(text).toMatch(/odoo.*no harness/);
  });
  it('flags a harness for a tier that is not registered', () => {
    expect(tierRegistrationProblems(['erpnext'], ['erpnext'], ['erpnext', 'odoo']).join('\n')).toMatch(/odoo.*not in TIER_WORKFLOWS/);
  });
});

describe('AC-ECA-042 a supported workflow whose suite did not run fails', () => {
  const tiers = { erpnext: ERPNEXT_WORKFLOWS };
  const supportedIds = Object.entries(ERPNEXT_WORKFLOWS).filter(([, d]) => d.status === 'supported').map(([id]) => id);
  it('passes when every supported suite registered tests', () => {
    expect(suiteRunProblems(tiers, supportedIds.map((id) => ({ tier: 'erpnext', id, tests: 3 })))).toEqual([]);
  });
  it('flags a supported suite that never ran', () => {
    const ran = supportedIds.slice(1).map((id) => ({ tier: 'erpnext', id, tests: 3 }));
    expect(suiteRunProblems(tiers, ran).join('\n')).toMatch(new RegExp(`erpnext ${supportedIds[0]}.*not run`));
  });
  it('flags a suite that registered no tests', () => {
    const ran = supportedIds.map((id, i) => ({ tier: 'erpnext', id, tests: i === 0 ? 0 : 3 }));
    expect(suiteRunProblems(tiers, ran).join('\n')).toMatch(/registered no tests/);
  });
});

describe('AC-ECA-041 a stale version pin fails the parity test, naming tier and workflow', () => {
  it('flags a tier that pins the old version after a bump', () => {
    const bumped = { ...WORKFLOWS, 'party.match': { ...WORKFLOWS['party.match'], version: WORKFLOWS['party.match'].version + 1 } };
    const problems = parityProblems(TIER_WORKFLOWS, bumped, SUITES);
    expect(problems).toHaveLength(Object.keys(TIER_WORKFLOWS).length);
    for (const tier of Object.keys(TIER_WORKFLOWS)) expect(problems.join('\n')).toMatch(new RegExp(`${tier} party\\.match`));
  });
  it('accepts a tier that re-declares the bumped workflow as unavailable or pending against the new version', () => {
    const bumped = { ...WORKFLOWS, 'party.match': { ...WORKFLOWS['party.match'], version: 2 } };
    const tier = { ...ERPNEXT_WORKFLOWS, 'party.match': { status: 'unavailable', version: 2, reason: 'synthetic limitation' } } as TierWorkflows;
    expect(parityProblems({ synthetic: tier }, bumped, SUITES)).toEqual([]);
    const pending = { ...ERPNEXT_WORKFLOWS, 'party.match': { status: 'pending', version: 2, issue: 1609 } } as TierWorkflows;
    expect(parityProblems({ synthetic: pending }, bumped, SUITES)).toEqual([]);
  });
});

describe('declaration hygiene', () => {
  it('keeps every version pin a literal: a declarations file never imports the registry', () => {
    for (const tier of tiersOnDisk) {
      expect(readFileSync(`${SEAM}${tier}/workflowDeclarations.ts`, 'utf8'), tier).not.toMatch(/\bWORKFLOWS\b/);
    }
  });
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
