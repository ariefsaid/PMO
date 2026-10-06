import { describe, expect, it } from 'vitest';
import { loadOverdueFacts, renderOverdueMarkdown, runWhatsOverdue, type OverdueFacts } from '../../../../supabase/functions/agent-chat/overdue';
import { render } from '@testing-library/react';
import { Markdown } from '../../components/panel/Markdown';
import { fakeSupabase, opsOf, type FakeCall } from './testing/fakeSupabase';

const NOW = new Date('2026-10-05T18:00:00Z'); // 2026-10-06 in Asia/Jakarta
const P1 = '11111111-1111-4111-8111-111111111111';
const ctx = (role: string, client: unknown) =>
  ({ jwt: '', userId: 'u-me', orgId: 'org-1', role, supabase: client as never });

type Rows = Partial<Record<string, (c: FakeCall) => unknown>>;
function world(rows: Rows = {}) {
  return (c: FakeCall) => {
    const hit = rows[c.table];
    if (hit) return { data: hit(c), error: null };
    switch (c.table) {
      case 'profiles': return { data: c.columns === 'timezone' ? { timezone: 'Asia/Jakarta' } : [], error: null };
      case 'organizations': return { data: { default_timezone: 'UTC', default_locale: 'en-US', default_number_locale: 'en-US' }, error: null };
      case 'org_features': return { data: { enabled: true }, error: null };
      default: return { data: [], error: null };
    }
  };
}

describe('loadOverdueFacts — tasks (#787)', () => {
  it('AC-AIN-004 an Engineer gets only their own open, past-due, live tasks', async () => {
    const { client, calls } = fakeSupabase(world());
    await loadOverdueFacts(ctx('Engineer', client), NOW);
    expect(opsOf(calls, 'tasks')).toHaveLength(1);
    const [ops] = opsOf(calls, 'tasks');
    expect(ops).toContainEqual(['eq', 'assignee_id', 'u-me']);
    expect(ops).toContainEqual(['in', 'status', ['To Do', 'In Progress', 'Blocked']]);
    expect(ops).toContainEqual(['lt', 'end_date', '2026-10-06']);
    expect(ops).toContainEqual(['is', 'tombstoned_at', null]);
    expect(ops).toContainEqual(['is', 'archived_at', null]);
    expect(ops).toContainEqual(['limit', 51]);
  });

  it('AC-AIN-005 a PM gets tasks on projects they manage plus their own, de-duplicated, oldest first', async () => {
    const tA = { id: 't-a', name: 'A', end_date: '2026-10-03', project_id: P1, assignee_id: 'u-me' };
    const tB = { id: 't-b', name: 'B', end_date: '2026-10-01', project_id: P1, assignee_id: 'u-2' };
    const { client, calls } = fakeSupabase(world({
      projects: (c) => (c.columns === 'id' ? [{ id: P1 }] : [{ id: P1, name: 'Harbor' }]),
      tasks: (c) => (c.ops.some((o) => o[0] === 'eq' && o[1] === 'assignee_id') ? [tA] : [tA, tB]),
    }));
    const facts = await loadOverdueFacts(ctx('Project Manager', client), NOW);
    expect(opsOf(calls, 'projects')[0]).toContainEqual(['eq', 'project_manager_id', 'u-me']);
    expect(opsOf(calls, 'tasks').some((ops) => ops.some((o) => o[0] === 'in' && o[1] === 'project_id'))).toBe(true);
    expect(facts.tasks.map((t) => t.id)).toEqual(['t-b', 't-a']);
    expect(facts.tasks[0]).toMatchObject({ projectName: 'Harbor', dueDate: '2026-10-01', daysOverdue: 5 });
  });

  it('AC-AIN-005 archived projects are excluded from the managed set', async () => {
    const { client, calls } = fakeSupabase(world({ projects: () => [] }));
    await loadOverdueFacts(ctx('Project Manager', client), NOW);
    expect(opsOf(calls, 'projects')[0]).toContainEqual(['is', 'archived_at', null]);
  });

  it('Finance sees the whole org (no scope filter) and today follows the profile zone', async () => {
    const { client, calls } = fakeSupabase(world());
    const facts = await loadOverdueFacts(ctx('Finance', client), NOW);
    const [ops] = opsOf(calls, 'tasks');
    expect(ops.some((o) => o[1] === 'assignee_id' || o[1] === 'project_id')).toBe(false);
    expect(facts.asOf).toBe('2026-10-06');
  });

  it('flags truncation past the 50-row cap', async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ id: `t-${i}`, name: 'x', end_date: '2026-10-01', project_id: null, assignee_id: null }));
    const { client } = fakeSupabase(world({ tasks: () => many }));
    const facts = await loadOverdueFacts(ctx('Admin', client), NOW);
    expect(facts.tasks).toHaveLength(50);
    expect(facts.tasksTruncated).toBe(true);
  });
});

describe('loadOverdueFacts — invoices (#787)', () => {
  const inv = (si: string, date: string, terms: number | null, extra: Record<string, unknown> = {}) => ({
    id: si, si_number: si, invoice_date: date, received_date: null, erp_due_date: null, ...extra, erp_outstanding_amount: 100, currency: 'IDR',
    tax_treatment: 'inclusive', project_id: P1, companies: { name: 'PT Client', erp_payment_terms_days: terms },
  });

  it('AC-AIN-013 overdue = Unpaid and due before today, by deriveArDueDate', async () => {
    const { client, calls } = fakeSupabase(world({
      sales_invoices: () => [inv('SI-1', '2026-09-01', 30), inv('SI-2', '2026-09-20', 30), inv('SI-3', '2026-08-20', null)],
    }));
    const facts = await loadOverdueFacts(ctx('Finance', client), NOW);
    expect(opsOf(calls, 'sales_invoices')[0]).toContainEqual(['eq', 'status', 'Unpaid']);
    expect(facts.invoices?.map((i) => [i.siNumber, i.dueDate, i.daysOverdue])).toEqual([
      ['SI-3', '2026-09-19', 17],
      ['SI-1', '2026-10-01', 5],
    ]);
  });

  it('AC-AIN-013 selects received_date + erp_due_date, the columns the Sales Invoices Due column reads', async () => {
    const { client, calls } = fakeSupabase(world({ sales_invoices: () => [] }));
    await loadOverdueFacts(ctx('Finance', client), NOW);
    const cols = calls.find((c) => c.table === 'sales_invoices')!.columns;
    expect(cols).toContain('received_date');
    expect(cols).toContain('erp_due_date');
  });

  it('AC-AIN-013 an ERP due date is the due date when no receipt date is recorded', async () => {
    // terms-derived would be 2026-10-01 (overdue); the ERP date 2026-10-20 is authoritative → not overdue.
    const { client } = fakeSupabase(world({ sales_invoices: () => [inv('SI-E', '2026-09-01', 30, { erp_due_date: '2026-10-20' })] }));
    expect((await loadOverdueFacts(ctx('Finance', client), NOW)).invoices).toEqual([]);
    // an ERP date already past is reported as that date.
    const past = fakeSupabase(world({ sales_invoices: () => [inv('SI-F', '2026-09-30', 30, { erp_due_date: '2026-10-03' })] }));
    expect((await loadOverdueFacts(ctx('Finance', past.client), NOW)).invoices?.[0]).toMatchObject({ dueDate: '2026-10-03', daysOverdue: 3 });
  });

  it('AC-AIN-013 the receipt date anchors the terms (and beats the invoice date)', async () => {
    // invoice 2026-08-01 + 30 = 2026-08-31 (overdue); received 2026-09-20 + 30 = 2026-10-20 → not overdue.
    const { client } = fakeSupabase(world({ sales_invoices: () => [inv('SI-R', '2026-08-01', 30, { received_date: '2026-09-20' })] }));
    expect((await loadOverdueFacts(ctx('Finance', client), NOW)).invoices).toEqual([]);
  });

  it('AC-AIN-013 a terms value other than 30 is honoured', async () => {
    const { client } = fakeSupabase(world({ sales_invoices: () => [inv('SI-45', '2026-08-20', 45), inv('SI-14', '2026-09-20', 14)] }));
    const facts = await loadOverdueFacts(ctx('Finance', client), NOW);
    expect(facts.invoices?.map((i) => [i.siNumber, i.dueDate, i.daysOverdue])).toEqual([
      ['SI-45', '2026-10-04', 2],
      ['SI-14', '2026-10-04', 2],
    ].sort((a, b) => String(a[1]).localeCompare(String(b[1]))));
  });

  it('AC-AIN-006 Revenue off → no invoice read, no invoice section', async () => {
    const { client, calls } = fakeSupabase(world({ org_features: () => ({ enabled: false }) }));
    const facts = await loadOverdueFacts(ctx('Finance', client), NOW);
    expect(calls.some((c) => c.table === 'sales_invoices')).toBe(false);
    expect(facts.invoices).toBeNull();
  });

  it('AC-AIN-006 the Revenue flag read is scoped to the caller org (a platform operator can see several)', async () => {
    const { client, calls } = fakeSupabase(world());
    await loadOverdueFacts(ctx('Finance', client), NOW);
    expect(opsOf(calls, 'org_features')[0]).toContainEqual(['eq', 'org_id', 'org-1']);
    expect(opsOf(calls, 'org_features')[0]).toContainEqual(['eq', 'feature_key', 'revenue']);
  });

  it('AC-AIN-006 a MISSING org_features revenue row means off', async () => {
    const { client, calls } = fakeSupabase(world({ org_features: () => null }));
    const facts = await loadOverdueFacts(ctx('Finance', client), NOW);
    expect(calls.some((c) => c.table === 'sales_invoices')).toBe(false);
    expect(facts.invoices).toBeNull();
  });

  it('AC-AIN-004 an Engineer never triggers an invoice read', async () => {
    const { client, calls } = fakeSupabase(world());
    const facts = await loadOverdueFacts(ctx('Engineer', client), NOW);
    expect(calls.some((c) => c.table === 'sales_invoices')).toBe(false);
    expect(facts.invoices).toBeNull();
  });

  it('AC-AIN-005 a PM sees invoices on managed projects only; none managed → empty, no read', async () => {
    const managed = fakeSupabase(world({ projects: (c) => (c.columns === 'id' ? [{ id: P1 }] : []) }));
    await loadOverdueFacts(ctx('Project Manager', managed.client), NOW);
    expect(opsOf(managed.calls, 'sales_invoices')[0]).toContainEqual(['in', 'project_id', [P1]]);

    const none = fakeSupabase(world({ projects: () => [] }));
    const facts = await loadOverdueFacts(ctx('Project Manager', none.client), NOW);
    expect(none.calls.some((c) => c.table === 'sales_invoices')).toBe(false);
    expect(facts.invoices).toEqual([]);
  });
});

describe('renderOverdueMarkdown / runWhatsOverdue (#787)', () => {
  const base: OverdueFacts = {
    asOf: '2026-10-06', numberLocale: 'en-US', tasksTruncated: false, invoicesTruncated: false,
    tasks: [{ id: 't-1', name: '[x](https://evil.example)', projectId: P1, projectName: 'Harbor', assigneeName: 'Budi', dueDate: '2026-10-02', daysOverdue: 4 }],
    invoices: [{ id: 'si-1', siNumber: 'ACC-SINV-2026-00012', customerName: 'PT Client', outstanding: 1500.5, currency: 'USD', taxTreatment: 'inclusive', dueDate: '2026-10-01', daysOverdue: 5 }],
  };

  it('FR-AIN-007 links tasks to the project Tasks tab and invoices to the filtered list; escapes names', () => {
    const md = renderOverdueMarkdown(base);
    expect(md).toContain('**Overdue as of 6 Oct** — 1 task, 1 invoice');
    expect(md).toContain(`[\\[x\\]\\(https:\u200B//evil.example\\)](/projects/${P1}/tasks) — Harbor · due 2 Oct (4 days late) · Budi`);
    expect(md).toContain('[ACC-SINV-2026-00012](/sales-invoices?q=ACC-SINV-2026-00012) — PT Client · $1,500.50 outstanding (incl. tax) · due 1 Oct (5 days late)');
  });

  it('FR-AIN-008 every user-authored field renders as inert text (customer, assignee, project, name)', () => {
    const evil = '[click](https://evil.example) <b>x</b> https://evil.example www.evil.example a@evil.example';
    const facts: OverdueFacts = {
      ...base,
      tasks: [{ ...base.tasks[0], name: evil, projectName: evil, assigneeName: evil }],
      invoices: [{ ...base.invoices![0], customerName: evil, siNumber: evil }],
    };
    const { container } = render(<Markdown text={renderOverdueMarkdown(facts)} />);
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    // only the app's own two list links + the "more" footer may be anchors; nothing external, no raw HTML.
    expect(hrefs.every((h) => h!.startsWith('/'))).toBe(true);
    expect(container.querySelector('b')).toBeNull();
    const text = container.textContent!.replace(/\u200B/g, '');
    expect(text).toContain('www.evil.example');
    expect(text).toContain('https://evil.example');
  });

  it('FR-AIN-008 bare URLs and www. hosts in names never autolink (GFM)', () => {
    const f: OverdueFacts = {
      ...base,
      tasks: [{ ...base.tasks[0], projectId: null, name: 'see https://evil.example now', projectName: 'www.evil.example', assigneeName: 'x@evil.example' }],
      invoices: null,
    };
    const { container } = render(<Markdown text={renderOverdueMarkdown(f)} />);
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.textContent!.replace(/\u200B/g, '')).toContain('see https://evil.example now');
  });

  it('FR-AIN-007 a non-UUID project id and an invoice number with reserved characters never break the link', () => {
    const f: OverdueFacts = {
      ...base,
      tasks: [{ ...base.tasks[0], projectId: 'x/../../admin)' }],
      invoices: [{ ...base.invoices![0], siNumber: 'A (1)&q=2 #x' }],
    };
    const md = renderOverdueMarkdown(f);
    expect(md).not.toContain('x/../../admin');
    expect(md).toContain('/sales-invoices?q=A%20%281%29%26q%3D2%20%23x)');
  });

  it('caps each section at 10 rows and says how many more', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => ({ ...base.tasks[0], id: `t-${i}`, name: `T${i}` }));
    const md = renderOverdueMarkdown({ ...base, tasks, invoices: null });
    expect(md.match(/^- \[T/gm)).toHaveLength(10);
    expect(md).toContain('- …and 2 more');
    expect(md).not.toContain('**Invoices**');
    expect(md).toContain('— 12 tasks');
  });

  it('says plainly when nothing is overdue', () => {
    expect(renderOverdueMarkdown({ ...base, tasks: [], invoices: [] })).toBe('**Overdue as of 6 Oct** — nothing is overdue.\n\n');
  });

  it('FR-AIN-006 run returns the markdown plus a receipt without the list', async () => {
    const { client } = fakeSupabase(world({ tasks: () => [{ id: 't-1', name: 'Pour', end_date: '2026-10-02', project_id: P1, assignee_id: null }] }));
    const out = await runWhatsOverdue({}, ctx('Engineer', client), NOW);
    expect(out).toMatchObject({ receipt: { ok: true, overdueTasks: 1, overdueInvoices: null } });
    expect(JSON.stringify((out as { receipt: unknown }).receipt)).not.toContain('Pour');
  });

  it('a read failure becomes a plain error, never a partial list', async () => {
    const ok = world();
    const { client } = fakeSupabase((c) => (c.table === 'tasks' ? { data: null, error: { code: '42501' } } : ok(c)));
    expect(await runWhatsOverdue({}, ctx('Engineer', client), NOW)).toEqual({ error: 'whats_overdue could not read the overdue items right now.' });
  });
});
