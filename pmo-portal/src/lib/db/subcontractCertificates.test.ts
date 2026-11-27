import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setHidePricesActive } from '@/src/lib/priceReadPath';

const h = vi.hoisted(() => {
  const result = { value: {} as { data: unknown; error: unknown }, queue: [] as Array<{ data: unknown; error: unknown }> };
  const calls = {
    from: [] as string[],
    rpc: [] as Array<[string, unknown]>,
    select: [] as unknown[],
    eq: [] as unknown[],
    is: [] as unknown[],
    order: [] as unknown[],
    limit: [] as unknown[],
    range: [] as unknown[],
  };
  const next = () => (result.queue.length ? result.queue.shift()! : result.value);
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...a: unknown[]) => {
    (calls[name] as unknown[]).push(a.length === 1 ? a[0] : a);
    return builder;
  };
  for (const k of ['select', 'eq', 'is', 'order', 'limit', 'range'] as const) builder[k] = chain(k);
  builder.then = (resolve: (v: unknown) => unknown) => resolve(next());
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const rpc = vi.fn((n: string, a?: unknown) => { calls.rpc.push([n, a]); return Promise.resolve(next()); });
  return { from, rpc, calls, result };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  approveCertificate, billCertificate, cancelCertificate, getCertificateView, listCertificates,
  listOpenBackcharges, listRateLines, listSubcontractPos, prepareCertificate, prepareCertificateAcceptance, recordBackcharge,
  returnCertificate, setCertificateBackcharge, setDeselection, setRate, submitCertificate,
} from './subcontractCertificates';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  setHidePricesActive(false);
  h.from.mockClear();
  h.rpc.mockClear();
  for (const v of Object.values(h.calls)) (v as unknown[]).length = 0;
  h.result.value = { data: null, error: null };
  h.result.queue = [];
});
afterEach(() => setHidePricesActive(false));

describe('subcontractCertificates DAL', () => {
  it('listSubcontractPos qualifies procurements embed with purchase_orders_procurement_id_fkey', async () => {
    h.result.value = {
      data: [
        {
          id: 'po-1',
          po_number: 'PO-001',
          work_order_id: 'wo-1',
          currency: 'USD',
          procurements: { title: 'Subcontract PO', project_id: 'prj-1', vendor_id: 'v-1' },
        },
      ],
      error: null,
    };

    const res = await listSubcontractPos();
    expect(h.calls.from).toContain('purchase_orders');
    expect(h.calls.select[0]).toBe(
      'id, po_number, work_order_id, currency, procurements!purchase_orders_procurement_id_fkey!inner(title, project_id, vendor_id, is_subcontract)'
    );
    expect(res).toEqual([
      {
        po_id: 'po-1',
        po_number: 'PO-001',
        title: 'Subcontract PO',
        project_id: 'prj-1',
        vendor_id: 'v-1',
        work_order_id: 'wo-1',
        currency: 'USD',
      },
    ]);
  });

  it('reads subcontract POs and their procurement through masked views when price hiding is active', async () => {
    setHidePricesActive(true);
    h.result.value = { data: [], error: null };

    await listSubcontractPos();

    expect(h.calls.from).toContain('purchase_orders_masked');
    expect(h.calls.select[0]).toContain('procurements:procurements_masked!purchase_orders_procurement_id_fkey!inner');
  });
});

/** #2584: the server derives every figure — the client only carries keys, statuses and reasons, and never sends org_id. */
describe('certificate lifecycle calls (#2584)', () => {
  it('listCertificates reads one bounded page newest first, filters by status when asked, and reports hasMore', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({ id: `c${i}` }));
    h.result.queue.push({ data: rows, error: null });
    const page = await listCertificates({ status: 'submitted', offset: 50 });
    expect(page.rows).toHaveLength(50);
    expect(page.hasMore).toBe(true);
    expect(h.calls.eq).toContainEqual(['status', 'submitted']);
    expect(h.calls.order).toContainEqual(['period_start', { ascending: false }]);
    expect(h.calls.range).toContainEqual([50, 100]);

    h.result.queue.push({ data: [{ id: 'c1' }], error: null });
    const one = await listCertificates();
    expect(one.hasMore).toBe(false);
    expect(one.rows).toEqual([{ id: 'c1' }]);
    expect(h.calls.eq.filter((entry) => (entry as unknown[])[0] === 'status')).toHaveLength(1); // no status filter when unfiltered
  });

  it('getCertificateView asks the view RPC for the certificate', async () => {
    const view = { certificate: { id: 'c1' }, derived: { lines: [], excluded: [], unrated: [], backcharges: [], gross: 0, backcharge_total: 0, net: 0 } };
    h.result.queue.push({ data: view, error: null });
    await expect(getCertificateView('c1')).resolves.toBe(view);
    expect(h.calls.rpc).toEqual([['subcontract_certificate_view', { p_certificate: 'c1' }]]);
  });

  it('the four state changes and the preparation go through their own RPC with the id (and the reason where one exists)', async () => {
    h.result.queue.push({ data: 'c-new', error: null });
    await expect(prepareCertificate('po1', '2026-03-01')).resolves.toBe('c-new');
    expect(h.calls.rpc.at(-1)).toEqual(['prepare_subcontract_certificate', { p_po_id: 'po1', p_period_start: '2026-03-01' }]);
    for (const [fn, args] of [
      ['submit_subcontract_certificate', { p_certificate: 'c1' }],
      ['return_subcontract_certificate', { p_certificate: 'c1', p_reason: 'measured twice' }],
      ['approve_subcontract_certificate', { p_certificate: 'c1' }],
      ['cancel_subcontract_certificate', { p_certificate: 'c1', p_reason: 'duplicate' }],
    ] as const) {
      h.result.queue.push({ data: null, error: null });
      if (fn.startsWith('submit')) await submitCertificate('c1');
      else if (fn.startsWith('return')) await returnCertificate('c1', 'measured twice');
      else if (fn.startsWith('approve')) await approveCertificate('c1');
      else await cancelCertificate('c1', 'duplicate');
      expect(h.calls.rpc.at(-1)).toEqual([fn, args]);
    }
  });

  it('a SoD or rule refusal keeps its Postgres code so the screen can name it', async () => {
    h.result.queue.push({ data: null, error: { message: 'not yours', code: '42501' } });
    await expect(submitCertificate('c1')).rejects.toMatchObject({ code: '42501' });
    h.result.queue.push({ data: null, error: { message: 'cap', code: 'SC001', details: 'cap reached' } });
    await expect(submitCertificate('c1')).rejects.toSatisfy((e: AppError) => e instanceof AppError && e.details === 'cap reached');
  });

  it('bill sends the date and only then the reference when one exists; the result carries status verbatim', async () => {
    const billed = { status: 'billed', invoice_id: 'inv1', payable: 100 };
    h.result.queue.push({ data: billed, error: null });
    await expect(billCertificate({ certificateId: 'c1', invoiceDate: '2026-03-10' })).resolves.toBe(billed);
    expect(h.calls.rpc.at(-1)).toEqual(['bill_subcontract_certificate', { p_certificate: 'c1', p_invoice_date: '2026-03-10' }]);
    h.result.queue.push({ data: { status: 'refused', code: '23505', message: 'billed' }, error: null });
    await expect(billCertificate({ certificateId: 'c1', invoiceDate: '2026-03-10', referenceNumber: 'REF-1' }))
      .resolves.toMatchObject({ status: 'refused' });
    expect(h.calls.rpc.at(-1)).toEqual(['bill_subcontract_certificate', { p_certificate: 'c1', p_invoice_date: '2026-03-10', p_reference_number: 'REF-1' }]);
  });

  it('setDeselection carries the measured-day tuple and the reason only when deselecting with one', async () => {
    h.result.queue.push({ data: null, error: null });
    await setDeselection({ certificateId: 'c1', workDate: '2026-03-02', workOrderLineId: 'l1', crewId: 'cr1', deselect: true, reason: 'rain' });
    expect(h.calls.rpc.at(-1)).toEqual(['set_certificate_deselection', {
      p_certificate: 'c1', p_work_date: '2026-03-02', p_work_order_line: 'l1', p_crew: 'cr1', p_deselect: true, p_reason: 'rain',
    }]);
    h.result.queue.push({ data: null, error: null });
    await setDeselection({ certificateId: 'c1', workDate: '2026-03-02', workOrderLineId: 'l1', crewId: 'cr1', deselect: false });
    expect(h.calls.rpc.at(-1)).toEqual(['set_certificate_deselection', {
      p_certificate: 'c1', p_work_date: '2026-03-02', p_work_order_line: 'l1', p_crew: 'cr1', p_deselect: false,
    }]);
  });

  it('acceptance preparation returns its id', async () => {
    h.result.queue.push({ data: 'acc1', error: null });
    await expect(prepareCertificateAcceptance('c1')).resolves.toBe('acc1');
    expect(h.calls.rpc.at(-1)).toEqual(['prepare_certificate_acceptance', { p_certificate: 'c1' }]);
  });

  it('backcharges: record always sends the work order (null when untied) and the text only when present; include/exclude goes through its RPC', async () => {
    h.result.queue.push({ data: 'bc1', error: null });
    await expect(recordBackcharge({ vendorId: 'v1', projectId: 'p1', amount: 500, currency: 'IDR', reasonCode: 'DAM', workOrderId: 'wo1', reasonText: ' broken ' })).resolves.toBe('bc1');
    expect(h.calls.rpc.at(-1)).toEqual(['record_subcontract_backcharge', {
      p_vendor: 'v1', p_project: 'p1', p_amount: 500, p_currency: 'IDR', p_reason_code: 'DAM', p_work_order: 'wo1', p_reason_text: ' broken ',
    }]);
    h.result.queue.push({ data: 'bc2', error: null });
    await recordBackcharge({ vendorId: 'v1', projectId: 'p1', amount: 1, currency: 'IDR', reasonCode: 'OTH' });
    expect(h.calls.rpc.at(-1)).toEqual(['record_subcontract_backcharge', {
      p_vendor: 'v1', p_project: 'p1', p_amount: 1, p_currency: 'IDR', p_reason_code: 'OTH', p_work_order: null,
    }]);
    h.result.queue.push({ data: null, error: null });
    await setCertificateBackcharge('c1', 'bc1', true);
    expect(h.calls.rpc.at(-1)).toEqual(['set_certificate_backcharge', { p_certificate: 'c1', p_backcharge: 'bc1', p_include: true }]);
  });

  it('listOpenBackcharges reads only unarchived ones of the vendor+project, newest first, capped at 200', async () => {
    h.result.queue.push({ data: [{ id: 'bc1', amount: 500 }], error: null });
    await expect(listOpenBackcharges('v1', 'p1')).resolves.toEqual([{ id: 'bc1', amount: 500 }]);
    expect(h.calls.from).toEqual(['subcontract_backcharges']);
    expect(h.calls.eq).toContainEqual(['vendor_company_id', 'v1']);
    expect(h.calls.eq).toContainEqual(['project_id', 'p1']);
    expect(h.calls.is).toContainEqual(['archived_at', null]);
    expect(h.calls.limit).toContainEqual(200);
  });
});

describe('the rate card (#2584 FR-SPC-001/003)', () => {
  it('listRateLines scopes by vendor only when one is asked; ordered vendor, item, newest version', async () => {
    h.result.queue.push({ data: [{ id: 'r1', rate: 10 }], error: null });
    await expect(listRateLines('v1')).resolves.toEqual([{ id: 'r1', rate: 10 }]);
    expect(h.calls.eq).toContainEqual(['vendor_company_id', 'v1']);
    expect(h.calls.limit).toContainEqual(500);
    const eqCount = h.calls.eq.length;
    h.result.queue.push({ data: [], error: null });
    await listRateLines();
    expect(h.calls.eq.length).toBe(eqCount); // no vendor filter for the all-vendors read
  });

  it('setRate sends the period; the end date only when present', async () => {
    h.result.queue.push({ data: 'r1', error: null });
    await expect(setRate({ vendorId: 'v1', boqItemId: 'b1', unit: 'm3', rate: 12.5, currency: 'IDR', effectiveFrom: '2026-03-01', effectiveTo: '2026-06-30' })).resolves.toBe('r1');
    expect(h.calls.rpc.at(-1)).toEqual(['set_subcontractor_rate', {
      p_vendor: 'v1', p_boq_item: 'b1', p_unit: 'm3', p_rate: 12.5, p_currency: 'IDR', p_effective_from: '2026-03-01', p_effective_to: '2026-06-30',
    }]);
    h.result.queue.push({ data: 'r2', error: null });
    await setRate({ vendorId: 'v1', boqItemId: 'b1', unit: 'm3', rate: 12.5, currency: 'IDR', effectiveFrom: '2026-03-01' });
    expect(h.calls.rpc.at(-1)).toEqual(['set_subcontractor_rate', {
      p_vendor: 'v1', p_boq_item: 'b1', p_unit: 'm3', p_rate: 12.5, p_currency: 'IDR', p_effective_from: '2026-03-01',
    }]);
  });
});
