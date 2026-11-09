/**
 * #2104 perf(rbp) — ERP orphans lane. `ErpOrphansSection` rebuilt its `columns` array on every
 * render with `selected.has` read directly inside the checkbox cell, so every checkbox toggle
 * re-rendered every orphan row's checkbox subtree.
 *
 * AC-3 (as reviewed, finding 2): given the orphans tab, when one document is selected, then only
 * that row's select control re-renders — the other rows' BODIES are untouched and the table does
 * not re-render at all. The earlier oracle counted only `Checkbox` renders, which a memoised cell
 * alone satisfies while every row body still re-rendered; this file measures the row bodies too:
 *
 *  - `tableRenders` — parent-driven `DataTable` renders. A selection must not reach the table: the
 *    selection lives in a small external store the per-row controls subscribe to, so the column
 *    model keeps its identity and the body is never re-derived.
 *  - `rowBodies` — the per-row date and amount cell formatters, one call per row body render.
 *  - `checkboxRenders` — the row select controls, one render per row whose `checked` truly changed.
 *
 * Pre-fix each figure is ≥ 1 table render / 8 row bodies / 8 checkboxes on ONE selection (the
 * selection was a column-memo dependency); post-fix it is 0 / 0 / 1.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const probes = vi.hoisted(() => ({
  checkboxRenders: new Map<string, number>(),
  record: (label: string) => probes.checkboxRenders.set(label, (probes.checkboxRenders.get(label) ?? 0) + 1),
  reset: () => probes.checkboxRenders.clear(),
  tableRenders: 0,
  dateFormats: 0,
  amountFormats: 0,
  resetBodies: () => {
    probes.tableRenders = 0;
    probes.dateFormats = 0;
    probes.amountFormats = 0;
  },
}));

vi.mock('@/src/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/components/ui')>();
  const CountingCheckbox: React.FC<React.ComponentProps<typeof actual.Checkbox>> = (props) => {
    probes.record(props.label);
    return <actual.Checkbox {...props} />;
  };
  const CountingDataTable = ((props: Record<string, unknown>) => {
    probes.tableRenders += 1;
    const Real = actual.DataTable as unknown as React.FC<Record<string, unknown>>;
    return <Real {...props} />;
  }) as unknown as typeof actual.DataTable;
  return { ...actual, Checkbox: CountingCheckbox, DataTable: CountingDataTable };
});

// Every row body formats its date and its pre-tax amount; counting the formatters counts the row
// bodies that were actually re-rendered (the review's own probe for this lane).
vi.mock('@/src/lib/format', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/format')>();
  return {
    ...actual,
    formatDate: (value: Parameters<typeof actual.formatDate>[0]) => {
      probes.dateFormats += 1;
      return actual.formatDate(value);
    },
    formatCurrency: (...args: Parameters<typeof actual.formatCurrency>) => {
      probes.amountFormats += 1;
      return actual.formatCurrency(...args);
    },
  };
});

// The section's link mutation is the only data dependency in this test — it never runs here. The
// real hook hands back a STABLE `mutateAsync` (react-query binds it once per mutation observer), so
// the mock must too: a fresh `vi.fn()` per call would invalidate every memo that reads it and
// measure the mock instead of the app.
const linkMutations = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({
  useLinkErpDocuments: () => ({ mutateAsync: linkMutations.mutateAsync, isPending: false }),
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
  probes.resetBodies();
});

describe('#2104 ERP orphans lane — one selection re-renders only that row', () => {
  it('selecting one document re-renders only that row: no table render, no other row body, one select control', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ErpOrphansSection rows={DOCS} projectId="p1" canLink /></MemoryRouter>);

    // Every row's checkbox mounted once, and every row body was drawn once on mount.
    for (const doc of DOCS) {
      expect(probes.checkboxRenders.get(ROW_LABEL(doc)) ?? 0).toBe(1);
    }
    expect(probes.dateFormats).toBe(DOCS.length);
    expect(probes.amountFormats).toBe(DOCS.length);

    probes.reset();
    probes.resetBodies();
    await user.click(screen.getByRole('checkbox', { name: ROW_LABEL(DOCS[3]) }));

    // The selection never reaches the table: the column model and the body keep their identity.
    expect(probes.tableRenders).toBe(0);
    // No other row body was re-rendered...
    expect(probes.dateFormats).toBe(0);
    expect(probes.amountFormats).toBe(0);
    // ...and exactly the toggled row's select control re-rendered.
    expect(probes.checkboxRenders.get(ROW_LABEL(DOCS[3])) ?? 0).toBe(1);
    for (const doc of DOCS.filter((_, i) => i !== 3)) {
      expect(probes.checkboxRenders.get(ROW_LABEL(doc)) ?? 0).toBe(0);
    }
    // Behaviour: the toggled cell shows the new state, and the per-row actions collapse behind the
    // bulk bar (decision 5) — the only other per-row change a first selection causes.
    expect(screen.getByRole('checkbox', { name: ROW_LABEL(DOCS[3]) })).toBeChecked();
    expect(screen.queryByRole('button', { name: /^Link DOC-/ })).toBeNull();
  });

  it('selecting a second document re-renders only the newly selected row, and nothing else', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ErpOrphansSection rows={DOCS} projectId="p1" canLink /></MemoryRouter>);
    await user.click(screen.getByRole('checkbox', { name: ROW_LABEL(DOCS[3]) }));

    probes.reset();
    probes.resetBodies();
    await user.click(screen.getByRole('checkbox', { name: ROW_LABEL(DOCS[6]) }));

    expect(probes.tableRenders).toBe(0);
    expect(probes.dateFormats).toBe(0);
    expect(probes.amountFormats).toBe(0);
    expect(probes.checkboxRenders.get(ROW_LABEL(DOCS[6])) ?? 0).toBe(1);
    for (const doc of DOCS.filter((_, i) => i !== 6)) {
      expect(probes.checkboxRenders.get(ROW_LABEL(doc)) ?? 0).toBe(0);
    }
  });

  it('select-all re-renders every select control once and still does not re-render the table', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ErpOrphansSection rows={DOCS} projectId="p1" canLink /></MemoryRouter>);

    probes.reset();
    probes.resetBodies();
    await user.click(screen.getByRole('checkbox', { name: `Select all ${DOCS.length} documents` }));

    expect(probes.tableRenders).toBe(0);
    expect(probes.dateFormats).toBe(0);
    for (const doc of DOCS) {
      expect(probes.checkboxRenders.get(ROW_LABEL(doc)) ?? 0).toBe(1);
    }
    for (const doc of DOCS) {
      expect(screen.getByRole('checkbox', { name: ROW_LABEL(doc) })).toBeChecked();
    }
  });
});
