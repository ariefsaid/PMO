/**
 * AC-BUD-012 — erpnext/bodies/budget.ts: the ERP `Budget` body (PMO → ERP, ADR-0055 §6 + ADR-0059
 * Posture B). Every field expectation below is frozen by docs/spikes/2026-07-16-erpnext-budget-fields.md.
 */
import { describe, expect, it } from 'vitest';
import { budgetToBody, budgetFromDoc, BUDGET_FROM_DOC_FIELDS } from './budget.ts';
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';

const MAP = [
  { category: 'Labor', erp_account: 'Salary - PSC' },
  { category: 'Materials', erp_account: 'Cost of Goods Sold - PSC' },
  { category: 'Equipment', erp_account: 'Office Maintenance Expenses - PSC' },
];

function ctx(overrides: { refs?: Record<string, string | null>; config?: Record<string, unknown> } = {}): ErpCtx {
  return {
    refs: { project: 'PROJ-0001', ...overrides.refs },
    config: { company: 'PMO Smoke Co', category_account_map: MAP, ...overrides.config },
  };
}

const VERSION = {
  id: 'ver-1',
  fiscal_year: '2026',
  line_items: [
    { category: 'Labor', budgeted_amount: '50000.00' },
    { category: 'Materials', budgeted_amount: '25000.00' },
    { category: 'Equipment', budgeted_amount: '0.00' }, // zero → omitted
  ],
  // ⚑ Present on the PMO record but MUST NOT reach ERP (FR-BUD-160): pushing a PMO forecast would put
  // an estimate into the client's GL controls.
  pmo_etc: '35000.00',
} as unknown as PmoRecord;

describe('erpnext/bodies/budget — the ERP Budget body (AC-BUD-012)', () => {
  it('AC-BUD-012 maps categories→accounts, uses the PROJECT dimension, omits zero rows, never leaks the projection', () => {
    const body = budgetToBody(VERSION, ctx()) as Record<string, unknown>;

    expect(body.company).toBe('PMO Smoke Co');
    expect(body.fiscal_year).toBe('2026');
    expect(body.budget_against).toBe('Project'); // FR-BUD-115 — the project dimension, always
    expect(body.project).toBe('PROJ-0001');
    expect(body.cost_center).toBeUndefined(); // ⚑ never a Cost-Center fallback (the dimensions are exclusive)
    expect(body.accounts).toEqual([
      { account: 'Salary - PSC', budget_amount: '50000.00' },
      { account: 'Cost of Goods Sold - PSC', budget_amount: '25000.00' },
    ]);
    // ⚑ FR-BUD-160: no projection value anywhere in the body, under any key.
    expect(JSON.stringify(body)).not.toContain('35000');
  });

  it('AC-BUD-012 ⚑ sets ALL SIX overspend-action fields to Warn — ERP defaults three of them to STOP', () => {
    const body = budgetToBody(VERSION, ctx()) as Record<string, unknown>;
    // Spike §1/§9: the doctype's own defaults are Stop for the three ANNUAL controls (actuals, MR, PO).
    // Omitting them would silently make the FIRST push start BLOCKING the client's purchase orders and
    // material requests org-wide — the exact blast radius FR-BUD-131 forbids as an integration side
    // effect. So the body states all six explicitly.
    expect(body).toMatchObject({
      action_if_annual_budget_exceeded: 'Warn',
      action_if_accumulated_monthly_budget_exceeded: 'Warn',
      action_if_annual_budget_exceeded_on_mr: 'Warn',
      action_if_accumulated_monthly_budget_exceeded_on_mr: 'Warn',
      action_if_annual_budget_exceeded_on_po: 'Warn',
      action_if_accumulated_monthly_budget_exceeded_on_po: 'Warn',
    });
  });

  it('AC-BUD-012 an explicit Admin opt-in to Stop is honoured on all six controls', () => {
    const body = budgetToBody(VERSION, ctx({ config: { budget_overspend_action: 'Stop' } })) as Record<string, unknown>;
    expect(body.action_if_annual_budget_exceeded).toBe('Stop');
    expect(body.action_if_annual_budget_exceeded_on_po).toBe('Stop');
  });

  it('AC-BUD-012 an unrecognised overspend action fails closed — never silently downgraded or passed through', () => {
    expect(() => budgetToBody(VERSION, ctx({ config: { budget_overspend_action: 'Block' } }))).toThrow(
      /overspend/i,
    );
  });

  it('AC-BUD-012 the applicable_on_* flags are sent only when configured, as 0/1', () => {
    const bare = budgetToBody(VERSION, ctx()) as Record<string, unknown>;
    expect(bare.applicable_on_purchase_order).toBeUndefined();

    const configured = budgetToBody(
      VERSION,
      ctx({ config: { budget_applicable_on: { purchase_order: true, material_request: false } } }),
    ) as Record<string, unknown>;
    expect(configured.applicable_on_purchase_order).toBe(1);
    expect(configured.applicable_on_material_request).toBe(0);
  });

  it('AC-BUD-012 fails closed (no body) when the ERP project ref is unresolvable — never an unattributed budget', () => {
    expect(() => budgetToBody(VERSION, ctx({ refs: { project: null } }))).toThrow(/project/i);
  });

  it('AC-BUD-012 fails closed when the binding names no company', () => {
    expect(() => budgetToBody(VERSION, ctx({ config: { company: undefined } }))).toThrow(/company/i);
  });

  it('AC-BUD-012 fails closed when the version carries no fiscal year — never a guessed year', () => {
    const noFy = { ...(VERSION as object), fiscal_year: null } as unknown as PmoRecord;
    expect(() => budgetToBody(noFy, ctx())).toThrow(/fiscal/i);
  });

  it('AC-BUD-012 ⚑ refuses an EMPTY accounts[] — the ERP crash guard (spike §10(a): a raw 500, not a 4xx)', () => {
    const allZero = { id: 'v', fiscal_year: '2026', line_items: [{ category: 'Labor', budgeted_amount: '0.00' }] } as unknown as PmoRecord;
    expect(() => budgetToBody(allZero, ctx())).toThrow(/no budgeted amount|accounts/i);
  });

  it('AC-BUD-011/012 an unmapped non-zero category propagates the fail-closed error, naming the categories', () => {
    const unmapped = {
      id: 'v',
      fiscal_year: '2026',
      line_items: [{ category: 'Contingency', budgeted_amount: '10000.00' }],
    } as unknown as PmoRecord;
    expect(() => budgetToBody(unmapped, ctx())).toThrow(/Contingency/);
  });

  it('AC-BUD-012 an absent category_account_map fails closed — an unconfigured org never pushes a partial budget', () => {
    expect(() => budgetToBody(VERSION, ctx({ config: { category_account_map: undefined } }))).toThrow(/Labor/);
  });

  it('AC-BUD-012 fromDoc mirrors ERP LIFECYCLE only — never a money figure back into PMO', () => {
    const rec = budgetFromDoc({
      name: 'BUDGET-2026-00001',
      docstatus: 1,
      modified: '2026-07-20 10:00:00',
      amended_from: null,
      fiscal_year: '2026',
      project: 'PROJ-0001',
      accounts: [{ account: 'Salary - PSC', budget_amount: 999999.0 }],
    });
    expect(rec).toEqual({
      id: 'BUDGET-2026-00001',
      erp_budget_name: 'BUDGET-2026-00001',
      erp_docstatus: 1,
      erp_modified: '2026-07-20 10:00:00',
      erp_amended_from: null,
      fiscal_year: '2026',
    });
    // ⚑ PMO is the SoT for the figure (OD-BUDGET-1). An ERP-side amount must have NO route home.
    expect(JSON.stringify(rec)).not.toContain('999999');
  });

  it('AC-BUD-012 BUDGET_FROM_DOC_FIELDS lists exactly the fields fromDoc reads (the sweep cannot drift)', () => {
    expect([...BUDGET_FROM_DOC_FIELDS]).toEqual(['name', 'modified', 'docstatus', 'amended_from', 'fiscal_year']);
  });
});
