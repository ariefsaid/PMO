/**
 * whats_overdue — the ONE coarse read tool for "what's overdue?" (#787, ADR-0079 §1).
 *
 * Why one tool: the deployed model is a weak tool-selector, and the fine-grained route (tasks need a project
 * filter → one read per project → an invoice read → due-date arithmetic) is exactly the multi-call plan it does
 * not make. This module does the whole read under the CALLER's JWT (ctx.supabase — RLS is the row authority;
 * never service_role) and returns a server-rendered answer the handler shows verbatim (ADR-0079 §3).
 */
import type { AgentAction, DeputyContext } from '../../../pmo-portal/src/lib/agent/runtime/port.ts';
import { deriveArDueDate } from '../../../pmo-portal/src/lib/repositories/revenueDisplay.ts';
import { AGENT_REVENUE_VIEW_ROLES } from '../../../pmo-portal/src/auth/agentRoles.ts';
import { WHATS_OVERDUE_SCHEMA } from './schema.ts';
import { asLoose, readOne, readRows, withTimeout, UUID_RE, type LooseClient, type LooseQuery } from './looseClient.ts';
import { daysBetween, escapeMarkdownText, formatMoney, formatShortDate, isoDateInZone, resolveNumberLocale } from './agentFormat.ts';

export const OVERDUE_TASK_CAP = 50;
export const OVERDUE_INVOICE_SCAN_CAP = 200;
const OPEN_TASK_STATUSES = ['To Do', 'In Progress', 'Blocked'] as const;

interface TaskRow { id: string; name: string; end_date: string; project_id: string | null; assignee_id: string | null }
interface InvoiceRow {
  id: string; si_number: string | null; invoice_date: string | null; erp_outstanding_amount: number | null;
  currency: string; tax_treatment: string; project_id: string | null;
  companies: { name: string | null; erp_payment_terms_days: number | null } | null;
}

export interface OverdueTask {
  id: string; name: string; projectId: string | null; projectName: string | null;
  assigneeName: string | null; dueDate: string; daysOverdue: number;
}
export interface OverdueInvoice {
  id: string; siNumber: string | null; customerName: string | null; outstanding: number | null;
  currency: string; taxTreatment: string; dueDate: string; daysOverdue: number;
}
export interface OverdueFacts {
  asOf: string;
  numberLocale: string;
  tasks: OverdueTask[];
  tasksTruncated: boolean;
  /** null = not shown (role may not view invoices, or Revenue is off) — DD-AIN-2. */
  invoices: OverdueInvoice[] | null;
  invoicesTruncated: boolean;
}

const unique = (xs: Array<string | null>): string[] => [...new Set(xs.filter((x): x is string => !!x))];

export async function loadOverdueFacts(ctx: DeputyContext, now: Date): Promise<OverdueFacts> {
  const sb: LooseClient = asLoose(ctx.supabase);
  const role = ctx.role ?? null;
  const [profile, org, feature] = await Promise.all([
    readOne<{ timezone: string | null }>(sb.from('profiles').select('timezone').eq('id', ctx.userId).maybeSingle()),
    readOne<{ default_timezone: string | null; default_locale: string | null; default_number_locale: string | null }>(
      sb.from('organizations').select('default_timezone, default_locale, default_number_locale').eq('id', ctx.orgId).maybeSingle(),
    ),
    readOne<{ enabled: boolean }>(sb.from('org_features').select('enabled').eq('feature_key', 'revenue').maybeSingle()),
  ]);
  // FR-AIN-002 / DD-AIN-1: "today" in the caller's own zone, else the org's, else UTC.
  const asOf = isoDateInZone(now, profile?.timezone || org?.default_timezone || 'UTC');

  // DD-AIN-2: a PM's "their projects" = the projects they manage (plus anything assigned to them).
  const managedIds: string[] | null = role === 'Project Manager'
    ? (await readRows<{ id: string }>(
        sb.from('projects').select('id').eq('project_manager_id', ctx.userId).is('archived_at', null).limit(500),
      )).map((p) => p.id)
    : null;

  const overdueTasks = (scope: (q: LooseQuery) => LooseQuery) =>
    readRows<TaskRow>(
      scope(
        sb.from('tasks').select('id, name, end_date, project_id, assignee_id')
          .in('status', OPEN_TASK_STATUSES).lt('end_date', asOf).is('tombstoned_at', null).is('archived_at', null),
      ).order('end_date', { ascending: true }).limit(OVERDUE_TASK_CAP + 1),
    );

  let taskRows: TaskRow[];
  if (role === 'Engineer') {
    taskRows = await overdueTasks((q) => q.eq('assignee_id', ctx.userId));
  } else if (role === 'Project Manager') {
    const ids = managedIds ?? [];
    const [mine, managed] = await Promise.all([
      overdueTasks((q) => q.eq('assignee_id', ctx.userId)),
      ids.length ? overdueTasks((q) => q.in('project_id', ids)) : Promise.resolve([] as TaskRow[]),
    ]);
    const byId = new Map([...mine, ...managed].map((t) => [t.id, t]));
    taskRows = [...byId.values()].sort((a, b) => a.end_date.localeCompare(b.end_date));
  } else {
    taskRows = await overdueTasks((q) => q);
  }
  const tasksTruncated = taskRows.length > OVERDUE_TASK_CAP;
  taskRows = taskRows.slice(0, OVERDUE_TASK_CAP);

  const projectIds = unique(taskRows.map((t) => t.project_id));
  const assigneeIds = unique(taskRows.map((t) => t.assignee_id));
  const [projects, people] = await Promise.all([
    projectIds.length
      ? readRows<{ id: string; name: string }>(sb.from('projects').select('id, name').in('id', projectIds))
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    assigneeIds.length
      ? readRows<{ id: string; full_name: string | null }>(sb.from('profiles').select('id, full_name').in('id', assigneeIds))
      : Promise.resolve([] as Array<{ id: string; full_name: string | null }>),
  ]);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const personName = new Map(people.map((p) => [p.id, p.full_name]));
  const tasks: OverdueTask[] = taskRows.map((t) => ({
    id: t.id,
    name: t.name,
    projectId: t.project_id,
    projectName: t.project_id ? projectName.get(t.project_id) ?? null : null,
    assigneeName: t.assignee_id ? personName.get(t.assignee_id) ?? null : null,
    dueDate: t.end_date,
    daysOverdue: daysBetween(t.end_date, asOf),
  }));

  // DD-AIN-2: invoices only for a role that may view them, in an org with Revenue on.
  let invoices: OverdueInvoice[] | null = null;
  let invoicesTruncated = false;
  if (feature?.enabled === true && role !== null && AGENT_REVENUE_VIEW_ROLES.includes(role)) {
    if (managedIds && managedIds.length === 0) {
      invoices = [];
    } else {
      let q = sb.from('sales_invoices')
        .select('id, si_number, invoice_date, erp_outstanding_amount, currency, tax_treatment, project_id, companies!sales_invoices_customer_id_fkey(name, erp_payment_terms_days)')
        .eq('status', 'Unpaid');
      if (managedIds) q = q.in('project_id', managedIds);
      const scanned = await readRows<InvoiceRow>(
        q.order('invoice_date', { ascending: true }).limit(OVERDUE_INVOICE_SCAN_CAP + 1),
      );
      const overdue: OverdueInvoice[] = [];
      for (const row of scanned.slice(0, OVERDUE_INVOICE_SCAN_CAP)) {
        // DD-AIN-1: the SAME due-date rule the Sales Invoices "Due" column renders (FR-SAR-141, AC-SAR-051).
        const due = deriveArDueDate(row.invoice_date, row.companies?.erp_payment_terms_days ?? null, null);
        if (!due || due >= asOf) continue;
        overdue.push({
          id: row.id, siNumber: row.si_number, customerName: row.companies?.name ?? null,
          outstanding: row.erp_outstanding_amount, currency: row.currency, taxTreatment: row.tax_treatment,
          dueDate: due, daysOverdue: daysBetween(due, asOf),
        });
      }
      overdue.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      invoicesTruncated = scanned.length > OVERDUE_INVOICE_SCAN_CAP || overdue.length > OVERDUE_TASK_CAP;
      invoices = overdue.slice(0, OVERDUE_TASK_CAP);
    }
  }
  return { asOf, numberLocale: resolveNumberLocale(org), tasks, tasksTruncated, invoices, invoicesTruncated };
}

export const OVERDUE_LIST_SHOWN = 10;
export const OVERDUE_TIMEOUT_MS = 8000;

export interface OverdueAnswer {
  markdown: string;
  receipt: {
    ok: true; asOf: string; overdueTasks: number; overdueInvoices: number | null;
    tasksTruncated: boolean; invoicesTruncated: boolean; note: string;
  };
}

const count = (n: number, more: boolean, one: string, many: string) =>
  `${n}${more ? '+' : ''} ${n === 1 && !more ? one : many}`;
const late = (d: number) => `${d} ${d === 1 ? 'day' : 'days'} late`;
const basis = (t: string) => (t === 'inclusive' ? 'incl. tax' : t === 'exclusive' ? 'excl. tax' : '');
/** A query value safe inside a markdown link destination (parentheses would end it early). */
const hrefParam = (v: string) => encodeURIComponent(v).replace(/\(/g, '%28').replace(/\)/g, '%29');

/** DD-AIN-7: the deterministic, server-written answer. Every user-authored string is escaped (FR-AIN-008). */
export function renderOverdueMarkdown(f: OverdueFacts): string {
  const head = `**Overdue as of ${formatShortDate(f.asOf)}**`;
  if (f.tasks.length === 0 && (f.invoices === null || f.invoices.length === 0)) return `${head} — nothing is overdue.`;
  const counts = [count(f.tasks.length, f.tasksTruncated, 'task', 'tasks')];
  if (f.invoices) counts.push(count(f.invoices.length, f.invoicesTruncated, 'invoice', 'invoices'));
  const lines = [`${head} — ${counts.join(', ')}`];

  if (f.tasks.length) {
    lines.push('', '**Tasks**');
    for (const t of f.tasks.slice(0, OVERDUE_LIST_SHOWN)) {
      const name = escapeMarkdownText(t.name);
      const title = t.projectId && UUID_RE.test(t.projectId) ? `[${name}](/projects/${t.projectId}/tasks)` : name;
      const where = t.projectName ? ` — ${escapeMarkdownText(t.projectName)}` : '';
      const who = t.assigneeName ? ` · ${escapeMarkdownText(t.assigneeName)}` : '';
      lines.push(`- ${title}${where} · due ${formatShortDate(t.dueDate)} (${late(t.daysOverdue)})${who}`);
    }
    const rest = f.tasks.length - Math.min(f.tasks.length, OVERDUE_LIST_SHOWN);
    if (rest > 0 || f.tasksTruncated) lines.push(`- …and ${rest}${f.tasksTruncated ? '+' : ''} more`);
  }

  if (f.invoices && f.invoices.length) {
    lines.push('', '**Invoices**');
    for (const i of f.invoices.slice(0, OVERDUE_LIST_SHOWN)) {
      const label = escapeMarkdownText(i.siNumber ?? 'Invoice');
      const href = i.siNumber ? `/sales-invoices?q=${hrefParam(i.siNumber)}` : '/sales-invoices';
      const who = i.customerName ? ` — ${escapeMarkdownText(i.customerName)}` : '';
      const b = basis(i.taxTreatment);
      const money = i.outstanding !== null
        ? ` · ${formatMoney(i.outstanding, i.currency, f.numberLocale)} outstanding${b ? ` (${b})` : ''}`
        : '';
      lines.push(`- [${label}](${href})${who}${money} · due ${formatShortDate(i.dueDate)} (${late(i.daysOverdue)})`);
    }
    const rest = f.invoices.length - Math.min(f.invoices.length, OVERDUE_LIST_SHOWN);
    if (rest > 0 || f.invoicesTruncated) lines.push(`- …and ${rest}${f.invoicesTruncated ? '+' : ''} more on [Sales Invoices](/sales-invoices)`);
  }
  return lines.join('\n');
}

export async function runWhatsOverdue(
  _input: unknown,
  ctx: DeputyContext,
  now: Date = new Date(),
): Promise<OverdueAnswer | { error: string }> {
  try {
    const facts = await withTimeout(loadOverdueFacts(ctx, now), OVERDUE_TIMEOUT_MS);
    return {
      markdown: renderOverdueMarkdown(facts),
      receipt: {
        ok: true,
        asOf: facts.asOf,
        overdueTasks: facts.tasks.length,
        overdueInvoices: facts.invoices ? facts.invoices.length : null,
        tasksTruncated: facts.tasksTruncated,
        invoicesTruncated: facts.invoicesTruncated,
        note: 'The overdue list is already shown to the user. Reply with at most one short sentence; do not repeat the list.',
      },
    };
  } catch {
    return { error: 'whats_overdue could not read the overdue items right now.' };
  }
}

export const whatsOverdueAction: AgentAction = {
  name: 'whats_overdue',
  description:
    "One call: the user's overdue tasks across their projects, plus overdue invoices when their role may see invoices. The list is shown to the user automatically.",
  inputSchema: WHATS_OVERDUE_SCHEMA,
  surfaces: ['agent'],
  confirm: false,
  run: (input: unknown, ctx: DeputyContext) => runWhatsOverdue(input, ctx),
};
