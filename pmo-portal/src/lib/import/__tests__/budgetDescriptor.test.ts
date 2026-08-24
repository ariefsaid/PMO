import { describe, it, expect, vi, beforeEach } from 'vitest';

const { budget } = vi.hoisted(() => ({
  budget: {
    findImportTargetDraft: vi.fn(),
    findImportedLine: vi.fn(),
    createVersion: vi.fn(),
    createLineItem: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { budget } }));

import { makeBudgetImportDescriptor, computeBudgetLineImportKey } from '../budgetDescriptor';
import { IMPORT_SKIPPED } from '../types';

const projects = [
  { id: 'prj-1', name: 'Apollo' },
  { id: 'prj-2', name: 'Borealis' },
];

/** A raw mapped-cell record as `useImportWizard` hands one to `toInput`. */
function cells(over: Partial<Record<string, string>> = {}) {
  return {
    projectId: 'Apollo',
    category: 'Labor',
    budgetedAmount: '1000',
    description: 'Site crew',
    fiscalYear: '2026',
    importKey: '',
    ...over,
  } as Record<string, string>;
}

describe('makeBudgetImportDescriptor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    budget.findImportTargetDraft.mockResolvedValue(null);
    budget.findImportedLine.mockResolvedValue(null);
    budget.createVersion.mockResolvedValue({ id: 'ver-new' });
    budget.createLineItem.mockResolvedValue({ id: 'line-new' });
  });

  const make = () => makeBudgetImportDescriptor(projects, 'batch-1');

  // ── the two exclusions that are the point of the ticket ──────────────────────────────────────

  it('AC-BIMP-003: exposes no status field, and never sends one', async () => {
    const d = make();
    expect(d.fields.map((f) => f.key)).not.toContain('status');
    await d.create(d.toInput(cells()));
    expect(budget.createVersion).toHaveBeenCalledTimes(1);
    // The version payload is (projectId, name, provenance) — status is not among the arguments at
    // all, so a Draft is achieved by omission and activation stays behind activate_budget_version.
    const [, name, provenance] = budget.createVersion.mock.calls[0];
    expect(name).toBe('Imported');
    expect(provenance).toEqual({ importBatchId: 'batch-1', importedAt: expect.any(String) });
    expect(provenance).not.toHaveProperty('status');
    expect(JSON.stringify(budget.createLineItem.mock.calls[0])).not.toMatch(/status/i);
  });

  it('AC-BIMP-004: exposes no actual_amount field, and never sends one', async () => {
    const d = make();
    expect(d.fields.map((f) => f.key)).not.toContain('actual_amount');
    expect(d.fields.map((f) => f.key)).not.toContain('actualAmount');
    // A sheet that HAS the column still cannot reach actual_amount: unmapped cells are ignored.
    await d.create(d.toInput({ ...cells(), actual_amount: '999' }));
    const [, item] = budget.createLineItem.mock.calls[0];
    expect(item).not.toHaveProperty('actual_amount');
    expect(JSON.stringify(budget.createLineItem.mock.calls[0])).not.toMatch(/999/);
  });

  it('never sends currency — 0187 stamp_currency owns it (FR-BIMP-006)', async () => {
    const d = make();
    expect(d.fields.map((f) => f.key)).not.toContain('currency');
    await d.create(d.toInput(cells()));
    expect(JSON.stringify(budget.createVersion.mock.calls[0])).not.toMatch(/currency/i);
  });

  // ── match-or-create ──────────────────────────────────────────────────────────────────────────

  it('AC-BIMP-001: two rows for one project create ONE version and TWO line items', async () => {
    const d = make();
    await d.create(d.toInput(cells({ description: 'Crew A' })));
    await d.create(d.toInput(cells({ description: 'Crew B' })));
    expect(budget.createVersion).toHaveBeenCalledTimes(1);
    expect(budget.createLineItem).toHaveBeenCalledTimes(2);
    expect(budget.createLineItem.mock.calls.every((c) => c[0] === 'ver-new')).toBe(true);
  });

  it('AC-BIMP-002: an existing Draft is attached to — no second version', async () => {
    budget.findImportTargetDraft.mockResolvedValue({ id: 'ver-existing' });
    const d = make();
    await d.create(d.toInput(cells()));
    expect(budget.createVersion).not.toHaveBeenCalled();
    expect(budget.createLineItem.mock.calls[0][0]).toBe('ver-existing');
  });

  it('AC-BIMP-007: no Draft (the only version is Active) → a NEW Draft, and the lines land IN it', async () => {
    // findImportTargetDraft filters on status='Draft', so an Active-only project answers null.
    budget.findImportTargetDraft.mockResolvedValue(null);
    // The lines were imported before, into the version that is now Active — the skip probe is
    // scoped to the NEW version, so it does not find them and they are written again.
    budget.findImportedLine.mockResolvedValue(null);
    const d = make();
    await d.create(d.toInput(cells()));
    expect(budget.createVersion).toHaveBeenCalledTimes(1);
    expect(budget.createLineItem).toHaveBeenCalledTimes(1);
    expect(budget.findImportedLine.mock.calls[0][0]).toBe('ver-new');
  });

  it('AC-BIMP-010: with several Drafts the repository probe picks the target — one call per project', async () => {
    budget.findImportTargetDraft.mockResolvedValue({ id: 'ver-highest' });
    const d = make();
    await d.create(d.toInput(cells()));
    await d.create(d.toInput(cells({ description: 'second' })));
    await d.create(d.toInput(cells({ projectId: 'Borealis' })));
    // Memoized per project: two probes for two projects, not three for three rows.
    expect(budget.findImportTargetDraft).toHaveBeenCalledTimes(2);
    expect(budget.findImportTargetDraft.mock.calls.map((c) => c[0])).toEqual(['prj-1', 'prj-2']);
  });

  // ── idempotency ──────────────────────────────────────────────────────────────────────────────

  it('AC-BIMP-005: a row already imported resolves to IMPORT_SKIPPED and writes nothing', async () => {
    budget.findImportTargetDraft.mockResolvedValue({ id: 'ver-existing' });
    budget.findImportedLine.mockResolvedValue({ id: 'line-old' });
    const d = make();
    const outcome = await d.create(d.toInput(cells()));
    expect(outcome).toBe(IMPORT_SKIPPED);
    expect(budget.createLineItem).not.toHaveBeenCalled();
  });

  it('AC-BIMP-005: the key survives a NEW batch id — the re-run is a no-op in a later session', () => {
    const first = makeBudgetImportDescriptor(projects, 'batch-1').toInput(cells());
    const second = makeBudgetImportDescriptor(projects, 'batch-2').toInput(cells());
    expect(second.importKey).toBe(first.importKey);
  });

  it('a 23505 from the race is a skip, not a failure (layer 2)', async () => {
    budget.createLineItem.mockRejectedValue({ code: '23505', message: 'duplicate key' });
    const d = make();
    await expect(d.create(d.toInput(cells()))).resolves.toBe(IMPORT_SKIPPED);
  });

  it('a non-duplicate error still propagates — a skip must not swallow an RLS rejection', async () => {
    budget.createLineItem.mockRejectedValue({ code: '42501', message: 'not authorized' });
    const d = make();
    await expect(d.create(d.toInput(cells()))).rejects.toMatchObject({ code: '42501' });
  });

  // ── keys + validation ────────────────────────────────────────────────────────────────────────

  it('FR-BIMP-011: a Reference cell IS the key; otherwise a content fingerprint', () => {
    const base = {
      project: 'Apollo', category: 'Labor', description: 'Crew',
      fiscalYear: '2026', amount: '1000', reference: '',
    };
    expect(computeBudgetLineImportKey({ ...base, reference: ' BL-7 ' })).toBe('BL-7');
    expect(computeBudgetLineImportKey(base)).toBe('fp:Apollo|Labor|Crew|2026|1000');
    // A different amount is a different line.
    expect(computeBudgetLineImportKey({ ...base, amount: '2000' })).not.toBe(
      computeBudgetLineImportKey(base),
    );
  });

  it('validates the project ref, the category enum and the amount', () => {
    const d = make();
    const field = (k: string) => d.fields.find((f) => f.key === k)!;
    expect(field('projectId').validate('Apollo')).toBeNull();
    expect(field('projectId').validate('Ghost')).toMatch(/not found/i);
    expect(field('projectId').validate('')).toMatch(/required/i);
    expect(field('category').validate('Labor')).toBeNull();
    expect(field('category').validate('Snacks')).toMatch(/Labor/);
    expect(field('budgetedAmount').validate('0')).toBeNull();
    expect(field('budgetedAmount').validate('-1')).toMatch(/non-negative/i);
    expect(field('budgetedAmount').validate('')).toMatch(/non-negative/i);
  });

  it('an omitted fiscal year stays NULL — PMO never invents another system’s calendar name', async () => {
    const d = make();
    await d.create(d.toInput(cells({ fiscalYear: '  ' })));
    const [, item] = budget.createLineItem.mock.calls[0];
    expect(item.fiscal_year).toBeNull();
  });
});
