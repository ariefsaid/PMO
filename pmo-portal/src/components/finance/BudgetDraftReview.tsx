import { useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useOptionalRealRole } from '@/src/auth/impersonation';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useOrgBudgetDrafts, invalidateBudgetQueries, budgetDistributionKey } from '@/src/hooks/useBudget';
import { formatCurrency } from '@/src/lib/format';
import { safeTrack, trackBudgetActivated } from '@/src/lib/analytics';
import type { OrgDraftBudget } from '@/src/lib/db/budgets';
import { savedPlanMatchesDraft, type DistributionReadinessStatus } from '@/src/lib/budget/savedDistribution';
import { draftTickState, type DraftTickState } from './draftTickState';
import { Button, Checkbox, ConfirmDialog } from '@/src/components/ui';

/** Readiness reads (an eligibility RPC and a live ERPNext precheck per draft) run for at most this many drafts at a time. */
const CHECK_CAP = 10;

type Outcome = 'activated' | 'erp-failed' | 'nothing-sent' | 'erp-pending';
/** Snapshot taken at activation time, so the outcome does not depend on the draft rows still being on the list. */
type RowResult = { id: string; label: string } & ({ ok: true; outcome: Outcome } | { ok: false; message: string });
const draftLabel = (r: OrgDraftBudget) => `${r.projectCode ? `${r.projectCode} ` : ''}${r.projectName} v${r.version}`;

/**
 * Review and activate imported draft budgets in one confirmed step. Every ticked draft goes through the SAME
 * per-budget `activateVersion` path as the Budget tab (same RPC, SoD, ERP push), one at a time; a refusal on one
 * row never stops the others. Nothing is activated that was not ticked. Self-hiding when there is nothing to review.
 */
export function BudgetDraftReview() {
  const { t } = useTranslation('financeHub');
  const may = usePermission();
  const { currentUser } = useAuth();
  const realRole = useOptionalRealRole();
  const qc = useQueryClient();
  // Role-only probe ("a draft someone else prepared"): a role that can activate nothing reads nothing. The per-draft rules stay in `can()` below and in the RPC.
  const canActivateAny = may('transition', 'budgetVersion', { currentUserId: currentUser?.id ?? null, record: { status: 'Draft', created_by: 'another-drafter', editor_ids: [] } });
  const drafts = useOrgBudgetDrafts(Boolean(currentUser) && canActivateAny);
  const rows = drafts.data ?? [];
  const [open, setOpen] = useState(false);
  const [checkedCount, setCheckedCount] = useState(CHECK_CAP);
  const isChecked = (i: number) => open && i < checkedCount;
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RowResult[]>([]);

  const modes = useQueries({ queries: rows.map((r, i) => ({
    queryKey: ['budget-activation-mode', r.id, currentUser?.org_id, currentUser?.id, currentUser?.role],
    queryFn: () => repositories.budget.getActivationMode(r.id),
    enabled: Boolean(currentUser?.id) && isChecked(i),
    refetchOnWindowFocus: false,
  })) });
  const prechecks = useQueries({ queries: rows.map((r, i) => ({
    queryKey: ['budget-activation-precheck', r.id],
    queryFn: () => repositories.budget.precheckActivation(r.id),
    staleTime: 0,
    enabled: isChecked(i),
    refetchOnWindowFocus: false,
  })) });

  // Whole-project drafts also need the Budget tab's distribution gate (saved plan vs the live ERPNext fiscal years).
  const distributions = useQueries({ queries: rows.map((r, i) => ({
    queryKey: budgetDistributionKey(currentUser?.org_id, r.projectId, r.id),
    queryFn: () => repositories.budget.getDistribution(r.id),
    enabled: r.budgetMode === 'whole_project' && isChecked(i),
    refetchOnWindowFocus: false,
  })) });

  if (!currentUser || (rows.length === 0 && results.length === 0)) return null;

  const view = rows.map((row, i) => {
    // A row that is refetching is not ready (as on the Budget tab), whatever its previous answer was.
    const mode = modes[i]?.isFetching ? undefined : modes[i]?.data;
    const precheck = prechecks[i]?.isFetching ? undefined : prechecks[i]?.data;
    const canTransition = may('transition', 'budgetVersion', {
      currentUserId: currentUser.id,
      record: { status: 'Draft', created_by: row.createdBy, editor_ids: row.editorIds },
    });
    const dq = distributions[i];
    const distribution: DistributionReadinessStatus = row.budgetMode !== 'whole_project' ? 'current'
      : dq?.isError ? 'error'
      : !dq || dq.isPending || dq.isFetching ? 'loading'
      : !dq.data ? 'absent'
      : savedPlanMatchesDraft(dq.data, row.lines, row.projectStart, row.projectEnd, precheck?.fiscalYears ?? null) ? 'current' : 'stale';
    return { row, mode, tick: draftTickState({ mode, precheck, canTransition, distribution, unchecked: !isChecked(i), checkFailed: !!(modes[i]?.isError || prechecks[i]?.isError) }) };
  });
  const selected = view.filter((v) => ticked.has(v.row.id) && v.tick === 'ready');
  const soleOperator = selected.some((v) => v.mode === 'sole_operator');
  const money = (r: OrgDraftBudget, amount: number) => formatCurrency(amount, r.currency || 'USD');
  const selectedTotals = new Map<string, number>();
  for (const v of selected) selectedTotals.set(v.row.currency, (selectedTotals.get(v.row.currency) ?? 0) + v.row.total);
  const totalText = [...selectedTotals].map(([c, n]) => formatCurrency(n, c || 'USD')).join(' + ');

  const toggle = (id: string, on: boolean) => setTicked((cur) => { const next = new Set(cur); if (on) next.add(id); else next.delete(id); return next; });
  const tickReasons: Record<Exclude<DraftTickState, 'ready'>, string> = {
    unchecked: t('draftReview.unchecked', 'Not checked yet'),
    checking: t('draftReview.checking', 'Checking…'),
    'check-failed': t('draftReview.checkFailed', "Couldn't check readiness"),
    unmapped: t('draftReview.unmapped', 'Map the budget categories first'),
    blocked: t('draftReview.blocked', 'Not ready to activate'),
    'not-allowed': t('draftReview.notAllowed', 'Someone else must activate this draft'),
    'blocked-editor': t('draftReview.blockedEditor', 'You drafted or edited this draft, so someone else must activate it.'),
    'needs-admin-finance': t('draftReview.needsAdminFinance', 'No drafter is recorded, so only Admin or Finance can activate this draft.'),
    'eligibility-unavailable': t('draftReview.eligibilityUnavailable', 'Activation eligibility is unavailable. Refresh this page and try again.'),
    'distribution-missing': t('draftReview.distributionMissing', "Save a fiscal-year distribution on the project's Budget tab first."),
    'distribution-stale': t('draftReview.distributionStale', "The saved fiscal-year distribution no longer matches this draft. Review it on the project's Budget tab."),
  };

  const activateSelected = async () => {
    setRunning(true);
    const next: RowResult[] = [];
    // Sequential on purpose: each activation locks its project and pushes to the ERP; one refusal must not stop the rest.
    for (const { row } of selected) {
      const base = { id: row.id, label: draftLabel(row) };
      try {
        const { pushState } = await repositories.budget.activateVersion(row.id);
        // The activation stands; a failed or empty ERP push is a consequence the operator must still hear about (as on the Budget tab).
        // rm-1472 — `pending-cancellation` is the 202 queue (an earlier cancellation is still settling): the
        // push is neither done nor broken, so it is reported as its own pending outcome.
        next.push({ ...base, ok: true, outcome: pushState === 'failed' ? 'erp-failed' : pushState === 'nothing-to-push' ? 'nothing-sent' : pushState === 'pending-cancellation' ? 'erp-pending' : 'activated' });
        safeTrack(() => trackBudgetActivated(realRole ?? 'unknown'));
      } catch (error) {
        next.push({ ...base, ok: false, message: classifyMutationError(error).detail || t('draftReview.failed', 'Could not activate') });
      }
      invalidateBudgetQueries(qc, currentUser.org_id, row.projectId);
    }
    setResults(next);
    setTicked(new Set());
    setConfirming(false);
    setRunning(false);
    void qc.invalidateQueries({ queryKey: ['org-budget-drafts'] });
    void qc.invalidateQueries({ queryKey: ['projects-money', currentUser.org_id] });
    void qc.invalidateQueries({ queryKey: ['finance-budget-review', currentUser.org_id] });
  };

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  const erpCount = results.filter((r) => r.ok && r.outcome === 'erp-failed').length;
  const emptyCount = results.filter((r) => r.ok && r.outcome === 'nothing-sent').length;
  const pendingErpCount = results.filter((r) => r.ok && r.outcome === 'erp-pending').length;
  const outcomeText: Record<Outcome, string> = {
    activated: t('draftReview.activated', 'Activated'),
    'erp-failed': t('draftReview.activatedErpFailed', 'Activated, but ERPNext was not updated'),
    'nothing-sent': t('draftReview.activatedNothingSent', 'Activated, but nothing was sent to ERPNext: no budget lines'),
    'erp-pending': t('draftReview.activatedErpPending', 'Activated, ERPNext update queued behind an earlier cancellation'),
  };

  return (
    <section aria-labelledby="budget-draft-review" className="mb-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="budget-draft-review" className="text-base font-semibold">{t('draftReview.title', 'Review and activate drafts')}</h2>
          <p className="text-sm text-muted-foreground">
            <span>{t('financeHub:draftReview.countToReview', { count: rows.length, defaultValue_one: '{{count}} draft to review.', defaultValue_other: '{{count}} drafts to review.' })}</span>{' '}
            {t('draftReview.hint', 'Check each draft against its source, tick the ones to activate, then confirm once. Each draft is activated and recorded on its own.')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {rows.length > 0 && <Button variant="outline" aria-expanded={open} disabled={running} onClick={() => setOpen((o) => !o)}>
            {open
              ? t('draftReview.hide', 'Hide drafts')
              : t('draftReview.review', { count: rows.length, defaultValue_one: 'Review {{count}} draft', defaultValue_other: 'Review {{count}} drafts' })}
          </Button>}
          {open && rows.length > 0 && (
            <Button variant="primary" disabled={selected.length === 0 || running} onClick={() => setConfirming(true)}>
              {t('draftReview.activateSelected', { count: selected.length, defaultValue: 'Activate selected ({{count}})' })}
            </Button>
          )}
        </div>
      </div>
      {results.length > 0 && (
        <div className="mt-2 text-sm">
          <p role="status">
            {t('draftReview.summary', { ok: okCount, failed: failCount, defaultValue: '{{ok}} activated, {{failed}} failed' })}
            {erpCount > 0 && <span className="block font-medium">{t('draftReview.erpNotUpdated', { count: erpCount, defaultValue: '{{count}} activated but ERPNext was not updated; ask Finance or an administrator to review it.' })}</span>}
            {emptyCount > 0 && <span className="block font-medium">{t('draftReview.nothingSent', { count: emptyCount, defaultValue: '{{count}} activated but nothing was sent to ERPNext (no budget lines); add lines and activate a new version to enforce one.' })}</span>}
            {pendingErpCount > 0 && <span className="block font-medium">{t('draftReview.erpPushQueued', { count: pendingErpCount, defaultValue: '{{count}} activated with the ERPNext push queued behind an earlier budget cancellation; it is pushed automatically once that settles.' })}</span>}
          </p>
          <ul className="mt-1 space-y-0.5">
            {results.map((r) => (
              <li key={r.id}>
                <span className="font-medium">{r.label}</span>{' '}
                <span className={r.ok ? (r.outcome === 'activated' ? '' : 'font-medium') : 'text-destructive'}>{r.ok ? outcomeText[r.outcome] : r.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {open && rows.length > 0 && (
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="w-8 py-1"><span className="sr-only">{t('draftReview.select', 'Select')}</span></th>
              <th scope="col" className="py-1">{t('draftReview.project', 'Project')}</th>
              <th scope="col" className="py-1">{t('draftReview.budget', 'Draft')}</th>
              <th scope="col" className="py-1 text-right tabular tabular-nums">{t('draftReview.total', 'Total')}</th>
              <th scope="col" className="py-1">{t('draftReview.mapped', 'All categories mapped')}</th>
              <th scope="col" className="py-1">{t('draftReview.source', 'Source document')}</th>
              <th scope="col" className="py-1">{t('draftReview.status', 'Status')}</th>
            </tr>
          </thead>
          <tbody>
            {view.map(({ row, tick }) => {
              const label = draftLabel(row);
              return (
                <tr key={row.id} className="border-t border-border">
                  <td className="py-1.5">
                    <Checkbox
                      label={t('draftReview.selectRow', { name: label, defaultValue: 'Select {{name}}' })}
                      checked={ticked.has(row.id) && tick === 'ready'}
                      disabled={tick !== 'ready' || running}
                      onChange={(on) => toggle(row.id, on)}
                    />
                  </td>
                  <td className="py-1.5">{row.projectCode ? `${row.projectCode} · ` : ''}{row.projectName}</td>
                  <td className="py-1.5">v{row.version} {row.name}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(row, row.total)}</td>
                  <td className="py-1.5">{tick === 'checking' ? '…' : tick === 'check-failed' || tick === 'unchecked' ? '—' : tick === 'unmapped' ? t('draftReview.no', 'No') : t('draftReview.yes', 'Yes')}</td>
                  <td className="py-1.5">
                    {row.documentUrl
                      ? <a href={row.documentUrl} target="_blank" rel="noopener noreferrer" className="text-primary-text underline underline-offset-2">{t('draftReview.open', 'Open')}</a>
                      : <span className="text-muted-foreground">{t('draftReview.noDocument', 'None linked')}</span>}
                  </td>
                  <td className="py-1.5">
                    {tick === 'ready' ? t('draftReview.ready', 'Ready') : tickReasons[tick]}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > checkedCount && (
          <p className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
            {t('draftReview.checkedOf', { checked: checkedCount, total: rows.length, defaultValue: 'Readiness checked for {{checked}} of {{total}} drafts' })}
            <Button variant="outline" size="sm" onClick={() => setCheckedCount(rows.length)}>{t('draftReview.checkRest', 'Check the rest')}</Button>
          </p>
        )}
      </div>
      )}
      {confirming && (
        <ConfirmDialog
          open
          tone="default"
          title={t('draftReview.confirmTitle', { count: selected.length, defaultValue_one: 'Activate {{count}} draft budget?', defaultValue_other: 'Activate {{count}} draft budgets?' })}
          description={[
            t('draftReview.confirmBody', {
              count: selected.length,
              total: totalText,
              defaultValue_one: 'This makes {{count}} draft (total {{total}}) the live active budget of its project and supersedes that project’s current active version. It is activated and recorded on its own.',
              defaultValue_other: 'This makes {{count}} drafts (total {{total}}) the live active budgets of their projects and supersedes each project’s current active version. Each is activated and recorded on its own; one refusal does not stop the others.',
            }),
            ...(soleOperator ? [t('draftReview.soleOperator', "You're the only person in this organisation, so you can activate budgets you prepared yourself. Once a colleague joins, a second person will need to activate them.")] : []),
          ].join(' ')}
          confirmLabel={t('draftReview.confirmLabel', { count: selected.length, defaultValue_one: 'Activate {{count}} draft', defaultValue_other: 'Activate {{count}} drafts' })}
          loading={running}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void activateSelected()}
        />
      )}
    </section>
  );
}
