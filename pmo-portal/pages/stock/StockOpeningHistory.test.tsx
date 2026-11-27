import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18next from 'i18next';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import stockEn from '@/public/locales/en/stock.json';
import importEn from '@/public/locales/en/import.json';
import refusalsEn from '@/public/locales/en/refusals.json';

const h = vi.hoisted(() => ({ preview: vi.fn(), load: vi.fn(), sheet: { headers: [] as string[], rows: [] as string[][] } }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stockOpening: { preview: h.preview, load: h.load } } }));
vi.mock('@/src/lib/import', async (orig) => ({ ...(await orig<typeof import('@/src/lib/import')>()), parseWorkbook: vi.fn(async () => h.sheet) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));
let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole: realRole }) }));

import StockOpeningHistory from './StockOpeningHistory';

const HEADERS = ['Date', 'Location', 'Item', 'Direction', 'Quantity', 'Unit cost', 'Reference'];
const verdict = (over: Record<string, unknown>) => ({
  rowNo: 1, verdict: 'ok', message: null, locationCode: 'WH-01', itemCode: 'CEM-50', occurredOn: '2026-01-10', direction: 'in', quantity: 10,
  unitCost: 5, reference: null, zeroCost: false, runQty: 10, runVal: 50, ...over,
});

const renderPage = (role: Role = 'Admin') => {
  realRole = role;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ToastProvider><MemoryRouter><StockOpeningHistory /></MemoryRouter></ToastProvider></QueryClientProvider>);
};
const chooseFile = async () => {
  const file = new File(['x'], 'opening.xlsx');
  Object.assign(file, { arrayBuffer: async () => new ArrayBuffer(0) });
  await userEvent.upload(screen.getByTestId('opening-file'), file);
};
const setDate = (v: string) => fireEvent.change(screen.getByLabelText(/Go-live date/), { target: { value: v } });

beforeAll(() => {
  i18next.addResourceBundle('en', 'stock', stockEn, true, true);
  i18next.addResourceBundle('en', 'import', importEn, true, true);
  i18next.addResourceBundle('en', 'refusals', refusalsEn, true, true);
  // a phone-style pointer renders the system date input, which the test can drive directly
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('coarse'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
});
beforeEach(() => {
  vi.clearAllMocks();
  h.sheet = { headers: HEADERS, rows: [['2026-01-10', 'WH-01', 'CEM-50', 'in', '10', '5', '']] };
  h.preview.mockResolvedValue([verdict({})]);
  h.load.mockResolvedValue(['o-1']);
});

describe('StockOpeningHistory (opening-stock-history)', () => {
  it('AC-OSH-014 a non-Admin sees who loads opening stock and no upload', () => {
    renderPage('Project Manager');
    expect(screen.getByText('An Admin loads opening stock')).toBeInTheDocument();
    expect(screen.queryByTestId('opening-file')).not.toBeInTheDocument();
  });

  it('AC-OSH-014 the template columns are on the screen, and Confirm says why it is disabled before a file is chosen', async () => {
    renderPage();
    for (const name of ['Date', 'Location', 'Item', 'Direction', 'Quantity', 'Unit cost', 'Reference']) expect((await screen.findAllByText(name)).length).toBeGreaterThan(0);
    expect(screen.getAllByText('The code of an existing stock location.').length).toBeGreaterThan(0);
    expect(screen.getByTestId('opening-download-template')).toBeInTheDocument();
    expect(screen.getByTestId('opening-confirm')).toBeDisabled();
    expect(screen.getByText('Choose the file first.')).toBeInTheDocument();
  });

  it('AC-OSH-014 a file with a refused row keeps Confirm disabled and names the refusal in plain words', async () => {
    h.sheet = { headers: HEADERS, rows: [['2026-01-10', 'WH-01', 'CEM-50', 'out', '99', '', '']] };
    h.preview.mockResolvedValue([verdict({ verdict: 'refused', message: 'OPN_OVER_ISSUE: row 1', direction: 'out', quantity: 99, runQty: 0, runVal: 0 })]);
    renderPage();
    setDate('2026-02-01');
    await chooseFile();
    await screen.findByText(/This out row is larger than what is on hand/);
    expect(screen.getByTestId('opening-confirm')).toBeDisabled();
    expect(screen.getByText(/Fix the 1 refused rows/)).toBeInTheDocument();
    expect(h.load).not.toHaveBeenCalled();
  });

  it('AC-OSH-014 a clean file confirms once, with the date and one request id, and the screen shows the result', async () => {
    renderPage();
    setDate('2026-02-01');
    await chooseFile();
    await waitFor(() => expect(screen.getByTestId('opening-confirm')).toBeEnabled());
    expect(h.preview).toHaveBeenCalledWith('2026-02-01', [expect.objectContaining({ item: 'CEM-50', direction: 'in', quantity: '10', unitCost: '5' })]);
    await userEvent.click(screen.getByTestId('opening-confirm'));
    await screen.findByText('Opening stock loaded');
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.load).toHaveBeenCalledWith('2026-02-01', expect.any(Array), expect.stringMatching(/^[0-9a-f-]{36}$/));
  });

  it('AC-OSH-014 a cell that fails the template is listed with its row and column, and nothing is sent to the database', async () => {
    h.sheet = { headers: HEADERS, rows: [['2026-01-10', 'WH-01', 'CEM-50', 'sideways', '10', '5', '']] };
    renderPage();
    setDate('2026-02-01');
    await chooseFile();
    await screen.findByText(/Write in \(stock arrived\) or out/);
    expect(h.preview).not.toHaveBeenCalled();
    expect(screen.getByTestId('opening-confirm')).toBeDisabled();
    expect(screen.getByText(/Fix the rows listed in your file/)).toBeInTheDocument();
  });

  it('AC-OSH-014 a file missing a column is refused with the column named', async () => {
    h.sheet = { headers: HEADERS.filter((x) => x !== 'Quantity'), rows: [['2026-01-10', 'WH-01', 'CEM-50', 'in', '5', '']] };
    renderPage();
    await chooseFile();
    expect(await screen.findByText('The file has no Quantity column. Use the template.')).toBeInTheDocument();
  });

  it('AC-OSH-004 a client-supplied item shows its closing balance as client-supplied, not as a value', async () => {
    h.preview.mockResolvedValue([verdict({ itemCode: 'STEEL', zeroCost: true, runQty: 8, runVal: 0, unitCost: 0 })]);
    renderPage();
    setDate('2026-02-01');
    await chooseFile();
    expect((await screen.findAllByText('Client-supplied')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/IDR/)).not.toBeInTheDocument();
  });

  it('AC-OSH-014 Confirm waits for the go-live date', async () => {
    renderPage();
    await chooseFile();
    expect(await screen.findByText('Choose the go-live date first.')).toBeInTheDocument();
    expect(screen.getByTestId('opening-confirm')).toBeDisabled();
  });
});

it("keeps the latest file when an earlier parse finishes late", async () => { const {parseWorkbook} = await import("@/src/lib/import"); let finish!: (value: typeof h.sheet) => void; vi.mocked(parseWorkbook).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); renderPage(); const first = new File(["x"], "first.xlsx"); const last = new File(["x"], "last.xlsx"); for (const f of [first,last]) Object.assign(f,{arrayBuffer: async () => new ArrayBuffer(0)}); await userEvent.upload(screen.getByTestId("opening-file"),first); await userEvent.upload(screen.getByTestId("opening-file"),last); await act(async () => finish(h.sheet)); expect(screen.queryByText(/first.xlsx ·/)).toBeNull(); expect(screen.getByText(/last.xlsx ·/)).toBeInTheDocument(); });
