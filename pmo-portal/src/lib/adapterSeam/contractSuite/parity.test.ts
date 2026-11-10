/**
 * AC-ECA-040..042 (FR-ECA-050/051/052) — the parity gate: every registered ERP tier declares every
 * workflow, at the current behaviour version, and a "supported" claim has a shared suite behind it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WORKFLOWS, type TierWorkflows } from '../connect/workflows.ts';
import { ERPNEXT_WORKFLOWS } from '../erpnext/workflowDeclarations.ts';
import { ODOO_TAX_DOCUMENT_UNAVAILABLE_REASON, ODOO_WORKFLOWS } from '../odoo/workflowDeclarations.ts';
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

describe('AC-OCI-094 Odoo revenue declarations match the shared suite versions', () => {
  it('supports invoice.push only after the production gate suite passes', () => {
    expect(ODOO_WORKFLOWS['invoice.push']).toEqual({ status: 'supported', version: WORKFLOWS['invoice.push'].version });
  });

  it('declares receipt.read supported now that the production feeds classify both payment directions', () => {
    expect(ODOO_WORKFLOWS['receipt.read']).toEqual({ status: 'supported', version: WORKFLOWS['receipt.read'].version });
  });

  it('leaves invoice pairing pending until its shared contract uses the production page mapping', () => {
    expect(SUITES['invoice.pair-existing']).toBeDefined();
    expect(ODOO_WORKFLOWS['invoice.pair-existing']).toEqual({ status: 'pending', version: WORKFLOWS['invoice.pair-existing'].version, issue: 1506 });
  });

  it('AC-OPP-084 accepts activation after the production resolver suite passes', () => {
    expect(SUITES['cutover.activation']).toBeDefined();
    expect(ODOO_WORKFLOWS['cutover.activation']).toEqual({ status: 'supported', version: WORKFLOWS['cutover.activation'].version });
  });

  it('AC-OPP-084 declares the procurement push workflows supported at their shared suite version', () => {
    for (const id of ['purchase.push', 'bill.push', 'vendor-payment.push', 'purchase-order.revise'] as const) {
      expect(SUITES[id], id).toBeDefined();
      expect(ODOO_WORKFLOWS[id], id).toEqual({ status: 'supported', version: WORKFLOWS[id].version });
    }
  });

  it('keeps revenue cutover pending on its owning issue until a shared suite exists', () => {
    expect(SUITES['cutover.revenue']).toBeUndefined();
    expect(ODOO_WORKFLOWS['cutover.revenue']).toEqual({ status: 'pending', version: WORKFLOWS['cutover.revenue'].version, issue: 1602 });
  });

  it('AC-OCI-094 keeps the owner-held tax-document workflow pending without a shared suite', () => {
    expect((WORKFLOWS as unknown as Record<string, unknown>)['tax-document.read']).toEqual({
      version: 1, summary: 'read tax-document facts from the ERP',
    });
    expect(SUITES['tax-document.read']).toBeUndefined();
    expect((ODOO_WORKFLOWS as unknown as Record<string, unknown>)['tax-document.read']).toEqual({
      status: 'unavailable', version: 1, reason: ODOO_TAX_DOCUMENT_UNAVAILABLE_REASON,
    });
    expect((ERPNEXT_WORKFLOWS as unknown as Record<string, unknown>)['tax-document.read']).toEqual({ status: 'pending', version: 1, issue: 1506 });
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
    const pending = { ...ERPNEXT_WORKFLOWS, 'party.match': { status: 'pending', version: 2, issue: 1505 } } as TierWorkflows;
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
    const tier = { ...ERPNEXT_WORKFLOWS, 'employee.send': { status: 'supported', version: WORKFLOWS['employee.send'].version } } as TierWorkflows;
    expect(parityProblems({ synthetic: tier }, WORKFLOWS, SUITES).join('\n')).toMatch(/employee\.send.*no shared suite/);
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

describe('AC-OFM-030/031 the register workflows are declared by every tier (#1511 F4)', () => {
  it('registers equipment.push and equipment.read at version 1', () => {
    expect(WORKFLOWS['equipment.push']).toEqual({ version: 1, summary: 'create or update a register asset or maintenance record in the ERP once, by key' });
    expect(WORKFLOWS['equipment.read']).toEqual({ version: 1, summary: 'read the ERP asset register and maintenance records into PMO' });
  });

  it('ERPNext declares both unavailable, with the Odoo-only reason a person reads', () => {
    for (const id of ['equipment.push', 'equipment.read'] as const) {
      const declared = ERPNEXT_WORKFLOWS[id];
      expect(declared.status).toBe('unavailable');
      expect(declared.status === 'unavailable' && declared.reason).toBe('ERPNext asset and maintenance screens are not built; the equipment register is available with Odoo only');
    }
  });

  it('Odoo declares both pending on the issue that ships their shared suite', () => {
    for (const id of ['equipment.push', 'equipment.read'] as const) {
      expect(ODOO_WORKFLOWS[id]).toEqual({ status: 'pending', version: WORKFLOWS[id].version, issue: 1511 });
    }
  });
});
