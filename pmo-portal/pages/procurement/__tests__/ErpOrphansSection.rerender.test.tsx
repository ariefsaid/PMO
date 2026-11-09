/**
 * #2104 perf(rbp) — ERP orphans lane. `ErpOrphansSection` rebuilt its `columns` array on every
 * render with `selected.has` read directly inside the checkbox cell, so every checkbox toggle
 * re-rendered every orphan row's checkbox subtree.
 *
 * AC: given the orphans tab, when one document is selected, then only that row re-renders.
 * The count comes from a counting wrapper swapped in for the shared `Checkbox` via the ui
 * barrel mock — before the fix every row's Checkbox re-renders on a toggle; after, the
 * memoised select cell bails out every row whose `checked` did not change.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const probes = vi.hoisted(() => ({
  checkboxRenders: new Map<string, number>(),
  record: (label: string) => probes.checkboxRenders.set(label, (probes.checkboxRenders.get(label) ?? 0) + 1),
  reset: () => probes.checkboxRenders.clear(),
}));

vi.mock('@/src/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/components/ui')>();
  const CountingCheckbox: React.FC<React.ComponentProps<typeof actual.Checkbox>> = (props) => {
    probes.record(props.label);
    return <actual.Checkbox {...props} />;
  };
  return { ...actual, Checkbox: CountingCheckbox };
});

// The section's link mutation is the only data dependency in this test — it never runs here.
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({
  useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { MemoryRouter } from 'react-router';
import { ErpOrphansSection } from '../ErpOrphansSection';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';

function makeDoc(i: number): ErpPurchaseRow {
  return {
    id: `doc-${i}`,
    doctype: 'Purchase Order',
    name: `DOC-${String(i).padStart(3, '0')}`,
    supplier: `Supplier ${i}`,
    docDate: '2026-06-01',
    dueDate: null,
    billNo: null,
    currency: 'USD',
    grandTotal: 100 + i,
    netTotal: 90 + i,
    outstanding: null,
    erpStatus: 'Submitted',
    isReturn: false,
    projectIds: [],
    procurementId: null,
    linkId: null,
  };
}

const DOCS = Array.from({ length: 8 }, (_, i) => makeDoc(i));
const ROW_LABEL = (doc: ErpPurchaseRow) => `Select ${doc.name}`;

beforeEach(() => {
  probes.reset();
});

describe('#2104 ERP orphans lane — one selection re-renders only that row', () => {
  it('selecting one document re-renders exactly one row checkbox; the others bail out', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ErpOrphansSection rows={DOCS} projectId="p1" canLink /></MemoryRouter>);

    // Every row's checkbox mounted once.
    for (const doc of DOCS) {
      expect(probes.checkboxRenders.get(ROW_LABEL(doc)) ?? 0).toBe(1);
    }

    probes.reset();
    await user.click(screen.getByRole('checkbox', { name: ROW_LABEL(DOCS[3]) }));

    // The toggled row re-rendered; every other row's checkbox subtree was skipped.
    expect(probes.checkboxRenders.get(ROW_LABEL(DOCS[3])) ?? 0).toBe(1);
    for (const doc of DOCS.filter((_, i) => i !== 3)) {
      expect(probes.checkboxRenders.get(ROW_LABEL(doc)) ?? 0).toBe(0);
    }
  });

  it('selecting a second document re-renders only the newly selected row (selection bar state aside)', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ErpOrphansSection rows={DOCS} projectId="p1" canLink /></MemoryRouter>);
    await user.click(screen.getByRole('checkbox', { name: ROW_LABEL(DOCS[3]) }));

    probes.reset();
    await user.click(screen.getByRole('checkbox', { name: ROW_LABEL(DOCS[6]) }));

    expect(probes.checkboxRenders.get(ROW_LABEL(DOCS[6])) ?? 0).toBe(1);
    for (const doc of DOCS.filter((_, i) => i !== 6)) {
      expect(probes.checkboxRenders.get(ROW_LABEL(doc)) ?? 0).toBe(0);
    }
  });
});
