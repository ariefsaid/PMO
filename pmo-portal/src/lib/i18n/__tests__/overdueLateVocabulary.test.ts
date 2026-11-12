import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Words ruling (docs/ux/screen-rules.md "Words"): a task or invoice past its due date is
 * "overdue" everywhere ("8 tasks overdue", "5 days overdue"); "late" is reserved for phases.
 * Never cross them. This suite locks the en and id catalogues to that split.
 *
 * Scope: keys are classified by their namespace + path into task / invoice / phase sets below.
 * The known crossings that still exist OUTSIDE these sets (out-of-scope test pins and one
 * shared task+phase key) are inventoried with file:line in
 * docs/private/ux-1110/shots/r2-overdue-words/notes.md (R2-OVERDUE-WORDS) — they get their own
 * slices; they are deliberately NOT allow-listed here.
 *
 * The id pair, decided from the existing catalogue: Indonesian has ONE word for both concepts —
 * "terlambat" — so the en late/overdue distinction collapses in id: overdue AND late both render
 * as "terlambat" (e.g. tasks "Tugas terlambat", invoices "Faktur terlambat", phases "Fase
 * terlambat"); the entity noun (tugas/faktur vs fase/tahapan) carries the distinction, with
 * "lewat jatuh tempo" as a longer overdue variant (hub.company.oldestOverdue). So the id side
 * pins the decided age pair and asserts key parity — no id word is prohibited anywhere.
 */
type Locale = 'en' | 'id';
const NS_FILES = [
  'common', 'dashboard', 'finance', 'financeHub', 'imprest', 'procurementRecord', 'project', 'status',
] as const;

function flatten(node: unknown, prefix = '', out: Map<string, string> = new Map()): Map<string, string> {
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else if (typeof node === 'string') {
    out.set(prefix, node);
  }
  return out;
}

function loadCatalogue(locale: Locale): Map<string, string> {
  const merged = new Map<string, string>();
  for (const ns of NS_FILES) {
    const file = join(process.cwd(), 'public/locales', locale, `${ns}.json`);
    for (const [k, v] of flatten(JSON.parse(readFileSync(file, 'utf8')))) {
      merged.set(`${ns}:${k}`, v);
    }
  }
  return merged;
}

const catalogues: Record<Locale, Map<string, string>> = { en: loadCatalogue('en'), id: loadCatalogue('id') };

/** Keys whose subject is a TASK (MyTasks rows, dashboards, project task attention items). */
const TASK_KEYS = [
  'common:myTasks.overdue',
  'status:age.overdue_one',
  'status:age.overdue_other',
  // status.age.late_* is the legacy plain-row wording consumed only by formatDaysLate; its only
  // caller was the MyTasks rows, which now use formatDaysOverdue. Re-worded to the overdue
  // vocabulary so the catalogue keeps no task-side "late" (see notes.md for the format.ts note).
  'status:age.late_one',
  'status:age.late_other',
  'project:projectDetail.myTasks.overdue',
  'project:projectDetail.myTasks.overdueCount',
  'project:projectDetail.attention.taskOverdue',
  'project:projectDetail.attention.taskBlockedOverdue',
  'project:projectDetail.attention.taskOverdueSize',
  'dashboard:needs.myTaskOverdueOne',
  'dashboard:needs.myTaskOverdueOther',
  'dashboard:needs.engineerTasks_one',
  'dashboard:needs.engineerTasks_other',
  'dashboard:needs.pmTasks_one',
  'dashboard:needs.pmTasks_other',
  'dashboard:hub.engineer.overdue',
  'dashboard:hub.engineer.noTasksDue',
  'dashboard:hub.pm.overdueTasks_one',
  'dashboard:home.colTasksOverdue',
  'dashboard:home.mobileTasksOverdue_one',
  'dashboard:home.overdueTasks_one',
  'dashboard:home.tasksOverdue',
  'dashboard:home.noOverdueTasks',
  'dashboard:home.overdueByProject',
  'dashboard:restructure.projectOverdueTasks_one',
  'dashboard:restructure.tasksDue',
] as const;

/** Keys whose subject is an INVOICE (client or supplier bills, receivables ageing). */
const INVOICE_KEYS = [
  'status:salesInvoice.overdue',
  'status:due.overdue',
  'common:uxs05.overdueOnly',
  'common:uxs17.overdue',
  'common:uxs17.daysOverdue',
  'common:dashboard.uxs36OverdueInvoicesFirst',
  'finance:area.overdueHeading',
  'finance:area.daysOverdue',
  'finance:area.openOverdueInvoice',
  'finance:receivables.overdue',
  'finance:receivables.overdueCount_one',
  // Key NAME keeps "Late" (historical); the rendered string says "overdue" — the string is the contract.
  'finance:receivables.statusPartlyPaidLate_one',
  'dashboard:home.colInvoicesOverdue',
  'dashboard:home.mobileInvoicesOverdue_one',
  // Column key named "late", value "Overdue" — receivables ageing column (CompanyDashboard).
  'dashboard:home.colLate',
  'dashboard:home.daysOverdue_one',
  'dashboard:home.noOverdue',
  'dashboard:home.overdueAmount',
  'dashboard:home.openInvoiceFor',
  'dashboard:home.overdueItems_one',
  'dashboard:home.allOverdue',
  'dashboard:needs.overdueInvoice_one',
  'dashboard:needs.unknownBalanceDays_one',
  'dashboard:needs.statusOverdue',
  'dashboard:figures.owedByClients',
  'dashboard:figures.noOverdue',
  'dashboard:figures.overdueUnknown',
  'dashboard:figures.unknownBalancesDays_one',
  'dashboard:hub.company.attentionOverdue_one',
  'dashboard:hub.company.oldestOverdue',
  'dashboard:hub.company.help.clientOverdue',
  'financeHub:hub.overdueCount',
  'financeHub:hub.oldest',
  'procurementRecord:money.overdue',
  'procurementRecord:timeline.overdue',
] as const;

/** Keys whose subject is a PHASE (delivery phases / milestones past their target date). */
const PHASE_KEYS = [
  'project:projectDetail.attention.phaseWhat',
  'project:projectDetail.attention.phasesWhat',
  'project:projectDetail.attention.phaseSize',
  'dashboard:home.colPhasesLate',
  'dashboard:home.mobilePhasesLate_one',
] as const;

/**
 * Explicit allow-list for keys that are genuinely NEITHER task/invoice nor phase, so they may
 * say "late" (en) without crossing:
 *  - imprest:plan.late — the imprest spending-plan realization flag (`plan.is_late`), a finance
 *    plan deadline, not a task/invoice/phase.
 */
const NEITHER_KEYS = ['imprest:plan.late'] as const;

describe('overdue/late vocabulary (screen-rules Words: overdue = tasks+invoices, late = phases)', () => {
  it('en: task and invoice keys never say "late"', () => {
    for (const key of [...TASK_KEYS, ...INVOICE_KEYS]) {
      const value = catalogues.en.get(key);
      expect(value, `missing en key ${key}`).toBeTruthy();
      expect(value, `en ${key} says "late": ${value}`).not.toMatch(/\blate\b/i);
    }
  });

  it('en: phase keys say "late" and never "overdue"', () => {
    for (const key of PHASE_KEYS) {
      const value = catalogues.en.get(key);
      expect(value, `missing en key ${key}`).toBeTruthy();
      expect(value, `en ${key} says "overdue": ${value}`).not.toMatch(/\boverdue\b/i);
      expect(value, `en ${key} should express lateness with "late": ${value}`).toMatch(/\blate\b/i);
    }
  });

  it('id: every classified key exists (en/id catalogue parity for the ruled vocabulary)', () => {
    for (const key of [...TASK_KEYS, ...INVOICE_KEYS, ...PHASE_KEYS, ...NEITHER_KEYS]) {
      expect(catalogues.id.get(key), `missing id key ${key}`).toBeTruthy();
    }
  });

  it('id: the decided age pair — "terlambat" covers both overdue and late (noun carries the split)', () => {
    // status:age.* is the shared age wording (en distinguishes overdue/late; id does not).
    expect(catalogues.id.get('status:age.overdue_one')).toBe('Terlambat {{n}} hari');
    expect(catalogues.id.get('status:age.late_one')).toBe('{{n}} hari terlambat');
  });

  it('allow-list covers only genuinely-neither keys (each resolves to a real string)', () => {
    expect(NEITHER_KEYS).toHaveLength(1);
    for (const key of NEITHER_KEYS) {
      expect(catalogues.en.get(key)).toBeTruthy();
    }
  });
});
