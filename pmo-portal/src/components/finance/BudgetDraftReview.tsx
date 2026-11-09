import { useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useOptionalRealRole } from '@/src/auth/impersonation';
import { repositories } from '@/src/lib/repositories';
import { useOrgBudgetDrafts, invalidateBudgetQueries, budgetDistributionKey } from '@/src/hooks/useBudget';
import { formatCurrency } from '@/src/lib/format';
import { safeTrack, trackBudgetActivated } from '@/src/lib/analytics';
import type { OrgDraftBudget } from '@/src/lib/db/budgets';
import { savedPlanMatchesDraft, type DistributionReadinessStatus } from '@/src/lib/budget/savedDistribution';
import { draftTickState, type DraftTickState } from './draftTickState';
import { Button, Checkbox, ConfirmDialog } from '@/src/components/ui';

type RowResult = { ok: true; erpNotUpdated: boolean } | { ok: false; message: string };

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
  const drafts = useOrgBudgetDrafts(true);
  const rows = drafts.data ?? [];
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<string, RowResult>>({});

  const modes = useQueries({ queries: rows.map((r) => ({
    queryKey: ['budget-activation-mode', r.id, currentUser?.org_id, currentUser?.id, currentUser?.role],
    queryFn: () => repositories.budget.getActivationMode(r.id),
    enabled: Boolean(currentUser?.id),
  })) });
  const prechecks = useQueries({ queries: rows.map((r) => ({
    queryKey: ['budget-activation-precheck', r.id],
    queryFn: () => repositories.budget.precheckActivation(r.id),
    staleTime: 0,
  })) });

  // Whole-project drafts also need the Budget tab's distribution gate (saved plan vs the live ERPNext fiscal years).
  const distributions = useQueries({ queries: rows.map((r) => ({
    queryKey: budgetDistributionKey(currentUser?.org_id, r.projectId, r.id),
    queryFn: () => repositories.budget.getDistribution(r.id),
    enabled: r.budgetMode === 'whole_project',
  })) });

  if (!currentUser || (rows.length === 0 && Object.keys(results).length === 0)) return null;

  const view = rows.map((row, i) => {
    const mode = modes[i]?.data;
    const precheck = prechecks[i]?.data;
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
    return { row, mode, tick: draftTickState({ mode, precheck, canTransition, distribution, checkFailed: !!(modes[i]?.isError || prechecks[i]?.isError) }) };
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
    const next: Record<string, RowResult> = {};
    // Sequential on purpose: each activation locks its project and pushes to the ERP; one refusal must not stop the rest.
    for (const { row } of selected) {
      try {
        const { pushState } = await repositories.budget.activateVersion(row.id);
        // The activation stands; a failed ERP push is a consequence the operator must still hear about (as on the Budget tab).
        next[row.id] = { ok: true, erpNotUpdated: pushState === 'failed' };
        safeTrack(() => trackBudgetActivated(realRole ?? 'unknown'));
      } catch (error) {
        next[row.id] = { ok: false, message: error instanceof Error ? error.message : t('draftReview.failed', 'Could not activate') };
      }
      invalidateBudgetQueries(qc, currentUser.org_id, row.projectId);
    }
    setResults((cur) => ({ ...cur, ...next }));
    setTicked(new Set());
    setConfirming(false);
    setRunning(false);
    void qc.invalidateQueries({ queryKey: ['org-budget-drafts'] });
    void qc.invalidateQueries({ queryKey: ['projects-money', currentUser.org_id] });
    void qc.invalidateQueries({ queryKey: ['finance-budget-review', currentUser.org_id] });
  };

  const done = Object.values(results);
  const okCount = done.filter((r) => r.ok).length;
  const failCount = done.length - okCount;
  const erpCount = done.filter((r) => r.ok && r.erpNotUpdated).length;

  return (
    <section aria-labelledby="budget-draft-review" className="mb-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="budget-draft-review" className="text-base font-semibold">{t('draftReview.title', 'Review and activate drafts')}</h2>
          <p className="text-sm text-muted-foreground">{t('draftReview.hint', 'Check each draft against its source, tick the ones to activate, then confirm once. Each draft is activated and recorded on its own.')}</p>
        </div>
        <Button variant="primary" disabled={selected.length === 0 || running} onClick={() => setConfirming(true)}>
          {t('draftReview.activateSelected', { count: selected.length, defaultValue: 'Activate selected ({{count}})' })}
        </Button>
      </div>
      {done.length > 0 && (
        <p role="status" className="mt-2 text-sm">
          {t('draftReview.summary', { ok: okCount, failed: failCount, defaultValue: '{{ok}} activated, {{failed}} failed' })}
          {erpCount > 0 && <span className="block font-medium">{t('draftReview.erpNotUpdated', { count: erpCount, defaultValue: '{{count}} activated but ERPNext was not updated; ask Finance or an administrator to review it.' })}</span>}
        </p>
      )}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="w-8 py-1"><span className="sr-only">{t('draftReview.select', 'Select')}</span></th>
              <th scope="col" className="py-1">{t('draftReview.project', 'Project')}</th>
              <th scope="col" className="py-1">{t('draftReview.budget', 'Draft')}</th>
              <th scope="col" className="py-1 text-right">{t('draftReview.total', 'Total')}</th>
              <th scope="col" className="py-1">{t('draftReview.mapped', 'All categories mapped')}</th>
              <th scope="col" className="py-1">{t('draftReview.source', 'Source document')}</th>
              <th scope="col" className="py-1">{t('draftReview.status', 'Status')}</th>
            </tr>
          </thead>
          <tbody>
            {view.map(({ row, tick }) => {
              const result = results[row.id];
              const label = `${row.projectCode ? `${row.projectCode} ` : ''}${row.projectName} v${row.version}`;
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
                  <td className="py-1.5">{tick === 'checking' ? '…' : tick === 'check-failed' ? '—' : tick === 'unmapped' ? t('draftReview.no', 'No') : t('draftReview.yes', 'Yes')}</td>
                  <td className="py-1.5">
                    {row.documentUrl
                      ? <a href={row.documentUrl} target="_blank" rel="noopener noreferrer" className="text-primary-text underline underline-offset-2">{t('draftReview.open', 'Open')}</a>
                      : <span className="text-muted-foreground">{t('draftReview.noDocument', 'None linked')}</span>}
                  </td>
                  <td className="py-1.5">
                    {result
                      ? <span role="status" className={result.ok ? '' : 'text-destructive'}>{result.ok ? t('draftReview.activated', 'Activated') : result.message}</span>
                      : tick === 'ready' ? t('draftReview.ready', 'Ready') : tickReasons[tick]}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {confirming && (
        <ConfirmDialog
          open
          tone="default"
          title={t('draftReview.confirmTitle', { count: selected.length, defaultValue: 'Activate {{count}} draft budgets?' })}
          description={[
            t('draftReview.confirmBody', { count: selected.length, total: totalText, defaultValue: 'This makes {{count}} drafts (total {{total}}) the live active budgets of their projects and supersedes each project’s current active version. Each is activated and recorded on its own; one refusal does not stop the others.' }),
            ...(soleOperator ? [t('draftReview.soleOperator', "You're the only person in this organisation, so you can activate budgets you prepared yourself. Once a colleague joins, a second person will need to activate them.")] : []),
          ].join(' ')}
          confirmLabel={t('draftReview.confirmLabel', { count: selected.length, defaultValue: 'Activate {{count}} drafts' })}
          loading={running}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void activateSelected()}
        />
      )}
    </section>
  );
}
