/**
 * #831 — Revenue by Project rows are per (project, currency). The export must carry each row's
 * currency and numeric money cells, or a USD row and an IDR row sum together in a spreadsheet.
 * The page's real columns are captured off DataTable and pushed through the real workbook writer.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import ExcelJS from 'exceljs';
import { ToastProvider, type Column } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { buildExportRows, toWorkbookBuffer } from '@/src/lib/export';

const table = vi.hoisted(() => ({ props: null as null | { rows: unknown[]; columns: unknown[] } }));
vi.mock('@/src/components/ui', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    DataTable: (props: { rows: unknown[]; columns: unknown[] }) => {
      table.props = props;
      return null;
    },
  };
});
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => 'USD',
  useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true, isError: false }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useRevenuePerProject: () => ({
    data: [
      { project_id: 'p1', project_name: 'Alpha', currency: 'USD', total_amount: 1000, open_ar: 250.5, invoice_count: 1 },
      { project_id: 'p1', project_name: 'Alpha', currency: 'IDR', total_amount: 2000000, open_ar: 0, invoice_count: 2 },
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-exec', org_id: 'org-1' }, role: 'Executive' }),
}));

import RevenueByProject from '../RevenueByProject';

describe('RevenueByProject export (#831)', () => {
  it('AC-831-2: each exported row names its currency and money cells are numeric', async () => {
    render(
      <ImpersonationProvider realRole="Executive">
        <MemoryRouter>
          <ToastProvider>
            <RevenueByProject />
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>,
    );
    expect(table.props).not.toBeNull();
    const { header, body } = buildExportRows(table.props!.rows, table.props!.columns as Column<unknown>[]);
    const buf = await toWorkbookBuffer({ sheetName: 'Sheet', header, body });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    const col = (name: string) => header.indexOf(name) + 1;

    expect(col('Currency')).toBeGreaterThan(0);
    expect(ws.getRow(2).getCell(col('Currency')).value).toBe('USD');
    expect(ws.getRow(3).getCell(col('Currency')).value).toBe('IDR');
    expect(ws.getRow(2).getCell(col('Total Revenue')).value).toBe(1000);
    expect(ws.getRow(2).getCell(col('Open AR')).value).toBe(250.5);
    expect(ws.getRow(3).getCell(col('Total Revenue')).value).toBe(2000000);
  });
});
