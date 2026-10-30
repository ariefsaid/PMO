import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import ExcelJS from 'exceljs';
import { ToastProvider } from '@/src/components/ui';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import { ErpOrphansSection } from './ErpOrphansSection';

const capture = vi.hoisted(() => ({ buffers: [] as ArrayBuffer[], link: vi.fn() }));
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: capture.link }) }));
vi.mock('@/src/lib/export', async (original) => {
  const actual = await original<typeof import('@/src/lib/export')>();
  return { ...actual, toWorkbookBuffer: async (...args: Parameters<typeof actual.toWorkbookBuffer>) => {
    const buffer = await actual.toWorkbookBuffer(...args);
    capture.buffers.push(buffer as ArrayBuffer);
    return buffer;
  } };
});
const row = (id: string, over: Partial<ErpPurchaseRow> = {}): ErpPurchaseRow => ({
  id, name: id, doctype: 'Purchase Order', supplier: null, docDate: null, dueDate: null, billNo: null,
  currency: 'USD', grandTotal: 120, netTotal: 100, outstanding: null, erpStatus: '', isReturn: false,
  projectIds: ['p1', 'missing-1', 'missing-2'], procurementId: null, linkId: null, ...over,
});
beforeEach(() => {
  capture.buffers = [];
  capture.link.mockReset();
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
describe('orphan workbook', () => {
  it('exports typed amounts, exact currencies and all project references', async () => {
    render(<MemoryRouter><ToastProvider><ErpOrphansSection canLink={false} projectNames={new Map([['p1', 'Tower']])} rows={[
      row('USD'), row('IDR', { currency: 'IDR', netTotal: 2500, projectIds: [] }),
      row('MISSING-AMOUNT', { currency: 'USD', netTotal: null, grandTotal: null }),
      row('MISSING-CURRENCY', { currency: null, netTotal: 42 }),
    ]} /></ToastProvider></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Export list' }));
    await waitFor(() => expect(capture.buffers).toHaveLength(1));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(capture.buffers[0]);
    const sheet = workbook.worksheets[0];
    const headers = (sheet.getRow(1).values as unknown[]).slice(1);
    const col = (name: string) => headers.indexOf(name) + 1;
    expect(col('Amount (pre-tax)')).toBeGreaterThan(0);
    expect(col('Currency')).toBe(col('Amount (pre-tax)') + 1);
    expect(sheet.getRow(2).getCell(col('Project')).value).toBe('Tower (p1), Project unavailable (missing-1), Project unavailable (missing-2)');
    expect(sheet.getRow(3).getCell(col('Project')).value).toBe('No project');
    expect(sheet.getRow(2).getCell(col('Amount (pre-tax)')).value).toBe(100);
    expect(sheet.getRow(2).getCell(col('Currency')).value).toBe('USD');
    expect(sheet.getRow(3).getCell(col('Amount (pre-tax)')).value).toBe(2500);
    expect(sheet.getRow(3).getCell(col('Currency')).value).toBe('IDR');
    expect(sheet.getRow(4).getCell(col('Amount (pre-tax)')).value).toBeFalsy();
    expect(sheet.getRow(4).getCell(col('Currency')).value).toBe('USD');
    expect(sheet.getRow(5).getCell(col('Amount (pre-tax)')).value).toBe(42);
    expect(sheet.getRow(5).getCell(col('Currency')).value).toBeFalsy();
  });
  it('targets the scoped project when linking a shared order', async () => {
    capture.link.mockResolvedValue({ results: [{ outcome: 'link', procurement_id: 'purchase-1' }] });
    render(<MemoryRouter><ToastProvider><ErpOrphansSection projectId="p1" canLink rows={[row('SHARED-ORDER')]} /></ToastProvider></MemoryRouter>);
    expect(screen.queryByRole('button', { name: 'Export list' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Link SHARED-ORDER' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'New purchase from this' }));
    expect(capture.link).toHaveBeenCalledWith({ rows: [{ erp_doctype: 'Purchase Order', erp_name: 'SHARED-ORDER', project_id: 'p1' }] });
  });
  it('does not offer an export in project scope and keeps the split invoice link rule', async () => {
    render(<MemoryRouter><ToastProvider><ErpOrphansSection projectId="p1" canLink rows={[row('SHARED', { doctype: 'Purchase Invoice' })]} /></ToastProvider></MemoryRouter>);
    expect(screen.queryByRole('button', { name: 'Export list' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Link SHARED' }));
    expect(screen.getByRole('menuitem', { name: /Split across projects/ })).toHaveAttribute('aria-disabled', 'true');
  });
});
