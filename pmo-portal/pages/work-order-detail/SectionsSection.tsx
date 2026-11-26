import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, ListState, RecordSection, StatusPill, SelectField, useToast, type StatusVariant } from '@/src/components/ui';
import { RowMenu } from '@/src/components/ui/RowMenu';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { useTerms } from '@/src/lib/i18n/terms';
import { useOrgProfilesLoader } from '@/src/hooks/useOrgProfilesLoader';
import {
  useArchiveSection, useDeleteSection, useSetSectionReadiness, useWorkOrderSectionReadiness, useWorkOrderSectionRollup, useWorkOrderSectionProgress,
} from '@/src/hooks/useWorkOrderSections';
import { READINESS_VALUES, type Readiness, type SectionRollupRow } from '@/src/lib/repositories/workOrderSections';
import { quantitiesByUnit, readinessRollup } from '@/src/lib/workOrderSections';
import { useSectionRefusal } from './useSectionRefusal';
import { formatExactMoney } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { SectionFormModal } from './SectionFormModal';
import { SectionReadinessModal } from './SectionReadinessModal';
import { SectionPlanModal } from './SectionPlanModal';
import { SectionMaterialModal } from './SectionMaterialModal';
import { SectionMaterialCheck } from './SectionMaterialCheck';

interface Props {
  workOrder: { id: string; project_id: string; status: string; currency: string };
}

const TONE: Record<Readiness, StatusVariant> = { ready: 'won', blocked: 'overdue', not_ready: 'neutral' };

/**
 * The work order's sections (#2576, FR-WOS-021): code, name, foreman, crews today, readiness, plan and task progress,
 * and one row for what is not in any section. Every figure is the server's roll-up read (`work_order_section_rollup`),
 * so the rows add up to the work order's own figures (the roll-up invariant). It appears only when the work order has a
 * section or the caller may add one. Affordances follow `can()` (UX only; RLS, column grants and the guard trigger decide).
 */
export const SectionsSection: React.FC<Props> = ({ workOrder }) => {
  const { t } = useTranslation('workOrderSections');
  const terms = useTerms();
  const sectionRefusal = useSectionRefusal();
  const { toast } = useToast();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const userId = useAuth().currentUser?.id ?? null;
  const roll = useWorkOrderSectionRollup(workOrder.id);
  const counts = useWorkOrderSectionReadiness(workOrder.id);
  const progress = useWorkOrderSectionProgress(workOrder.id);
  const setReadiness = useSetSectionReadiness(workOrder.id);
  const archive = useArchiveSection(workOrder.id);
  const remove = useDeleteSection(workOrder.id);
  const loadProfiles = useOrgProfilesLoader();
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<SectionRollupRow | 'new' | null>(null);
  const [planning, setPlanning] = useState<SectionRollupRow | null>(null);
  const [materialFor, setMaterialFor] = useState<SectionRollupRow | null>(null);
  const [readinessFor, setReadinessFor] = useState<SectionRollupRow | null>(null);
  const [archiving, setArchiving] = useState<SectionRollupRow | null>(null);
  const [deleting, setDeleting] = useState<SectionRollupRow | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void loadProfiles().then((ps) => { if (live) setNames(new Map(ps.map((p) => [p.id, p.full_name]))); }).catch(() => undefined);
    return () => { live = false; };
  }, [loadProfiles]);

  const validated = useMemo(() => {
    try { return quantitiesByUnit(progress.data ?? []); } catch { return new Map<string | null, { unit: string; quantity: string }[]>(); }
  }, [progress.data]);
  const viewOnly = realRole !== effectiveRole;
  const base = useMemo(() => ({ currentUserId: userId, record: { viewOnly, status: workOrder.status } }), [userId, viewOnly, workOrder.status]);
  const canAdd = may('create', 'workOrderSection', base);
  const rows = roll.data ?? [];
  const sections = rows.filter((r) => r.sectionId !== null);
  const remainder = rows.find((r) => r.sectionId === null) ?? null;
  const visible = sections.filter((r) => showArchived || r.archivedAt === null);
  const hasArchived = sections.some((r) => r.archivedAt !== null);
  const summary = readinessRollup(counts.data);
  const showPlan = rows.some((r) => r.directBudget !== null || r.indirectBudget !== null);
  const sectionWord = terms.section.toLowerCase();
  const vars = { section: sectionWord, sections: terms.sections.toLowerCase() };

  if (roll.isPending && !canAdd) return null;
  if (roll.isSuccess && sections.length === 0 && !canAdd) return null;

  const title = terms.sections;
  if (roll.isPending) return <RecordSection title={title} data-testid="wo-page-sections"><ListState variant="loading" rows={3} /></RecordSection>;
  if (roll.isError) {
    return (
      <RecordSection title={title} data-testid="wo-page-sections">
        <ListState variant="error" title={t('loadError', "Couldn't load {{sections}}", vars)} retryLabel={t('retry', 'Try again')} onRetry={() => void roll.refetch()} />
      </RecordSection>
    );
  }

  const money = (v: string | null) => (v === null ? '—' : formatExactMoney(v, workOrder.currency, getNumberLocale(), { wholeUnits: true }) ?? '—');
  const stateLabel = (r: Readiness) => t(`readiness.${r}`, r === 'ready' ? 'Ready' : r === 'blocked' ? 'Blocked' : 'Not ready');
  const summaryText = summary.state === 'none' ? null
    : summary.state === 'all_ready' ? t('summaryAll', 'All {{live}} ready', { live: summary.live })
    : summary.blocked > 0 ? t('summaryBlocked', '{{ready}} of {{live}} ready · {{blocked}} blocked', { ready: summary.ready, live: summary.live, blocked: summary.blocked })
    : t('summary', '{{ready}} of {{live}} ready', { ready: summary.ready, live: summary.live });

  const onReadiness = (row: SectionRollupRow, value: Readiness) => {
    setProblem(null);
    setReadiness.mutate({ id: row.sectionId as string, readiness: value, note: row.readinessNote }, {
      onError: (err) => setProblem(sectionRefusal(err).headline),
    });
  };
  const doArchive = async (row: SectionRollupRow, archived: boolean) => {
    setProblem(null);
    try { await archive.mutateAsync({ id: row.sectionId as string, archived }); toast(t('saved', 'Saved'), undefined, 'success'); setArchiving(null); }
    catch (err) { const r = sectionRefusal(err); setProblem([r.headline, r.detail].filter(Boolean).join(': ')); setArchiving(null); }
  };
  const doDelete = async (row: SectionRollupRow) => {
    setProblem(null);
    try { await remove.mutateAsync(row.sectionId as string); toast(t('saved', 'Saved'), undefined, 'success'); setDeleting(null); }
    catch (err) { const r = sectionRefusal(err); setProblem([r.headline, r.detail].filter(Boolean).join(': ')); setDeleting(null); }
  };

  const figures = (r: SectionRollupRow) => {
    const parts: React.ReactNode[] = [];
    const done = validated.get(r.sectionId);
    if (done && done.length > 0) {
      parts.push(<span key="v" className="tabular-nums">{t('validated', 'Validated: {{amounts}}', { amounts: done.map((d) => `${d.quantity} ${d.unit}`).join(', ') })}</span>);
    }
    if (r.tasksTotal > 0) parts.push(<span key="t">{t('tasks', '{{done}} of {{total}} tasks done', { done: r.tasksDone, total: r.tasksTotal })}</span>);
    if (r.crewsToday > 0) parts.push(<span key="c">{t('crews', '{{count}} crews today', { count: r.crewsToday })}</span>);
    return parts;
  };

  return (
    <RecordSection title={title} data-testid="wo-page-sections"
      actions={<>
        {hasArchived && <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>{showArchived ? t('hideArchived', 'Hide archived') : t('showArchived', 'Show archived')}</Button>}
        {canAdd && <Button variant="outline" size="sm" onClick={() => setEditing('new')}>{t('add', 'Add {{section}}', vars)}</Button>}
      </>}>
      {problem && <p role="alert" className="mb-3 text-control text-destructive" data-testid="wo-sections-problem">{problem}</p>}
      {summaryText && <p className="mb-2 text-control text-muted-foreground">{summaryText}</p>}
      {visible.length === 0 ? (
        <p className="text-control text-muted-foreground" data-testid="wo-sections-empty">{t('empty', 'No {{sections}} yet.', vars)}</p>
      ) : (
        <ul className="divide-y divide-border" data-testid="wo-sections-list">
          {visible.map((r) => {
            const rowCtx = { ...base, record: { ...base.record, foreman_id: r.foremanId } };
            const items = [
              { label: t('menu.readiness', 'Readiness and history'), onClick: () => setReadinessFor(r) },
              may('edit', 'workOrderSection', rowCtx) ? { label: t('menu.edit', 'Edit'), onClick: () => setEditing(r) } : null,
              may('set_plan', 'workOrderSection', rowCtx) ? { label: t('menu.plan', 'Plan'), onClick: () => setPlanning(r) } : null,
              may('set_plan', 'workOrderSection', rowCtx) && r.archivedAt === null ? { label: t('menu.material', 'Material'), onClick: () => setMaterialFor(r) } : null,
              may('archive', 'workOrderSection', rowCtx) ? (r.archivedAt === null
                ? { label: t('menu.archive', 'Archive'), onClick: () => setArchiving(r) }
                : { label: t('menu.restore', 'Restore'), onClick: () => void doArchive(r, false) }) : null,
              may('delete', 'workOrderSection', rowCtx) ? { label: t('menu.delete', 'Delete'), onClick: () => setDeleting(r), danger: true } : null,
            ].filter((x): x is { label: string; onClick: () => void; danger?: boolean } => x !== null);
            const canSetReadiness = may('set_readiness', 'workOrderSection', rowCtx) && r.archivedAt === null;
            return (
              <li key={r.sectionId as string} data-testid={`wo-section-${r.code}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-[1_1_14rem]">
                  <div className="font-medium">
                    <span className="tabular-nums">{r.code}</span> · {r.name}
                    {r.archivedAt !== null && <span className="ml-2 text-control font-normal text-muted-foreground">{t('archivedBadge', 'Archived')}</span>}
                  </div>
                  <div className="text-control text-muted-foreground">
                    {[r.foremanId ? names.get(r.foremanId) ?? null : null, r.locationNote].filter(Boolean).join(' · ')}
                  </div>
                  {figures(r).length > 0 && <div className="text-control text-muted-foreground flex flex-wrap gap-x-3">{figures(r)}</div>}
                </div>
                {showPlan && (
                  <div className="tabular-nums text-control" data-testid={`wo-section-plan-${r.code}`}>
                    <span className="text-muted-foreground">{t('planned', 'Planned')} </span>{money(r.directBudget)}
                  </div>
                )}
                <div>
                  {canSetReadiness && r.readiness
                    ? <SelectField compact inline hideLabel label={t('readiness.label', 'Readiness of {{code}}', { code: r.code })} value={r.readiness}
                        onChange={(v) => onReadiness(r, v as Readiness)}
                        options={READINESS_VALUES.map((v) => ({ value: v, label: stateLabel(v) }))} />
                    : r.readiness && <StatusPill variant={TONE[r.readiness]}>{stateLabel(r.readiness)}</StatusPill>}
                </div>
                <RowMenu ariaLabel={t('menu.row', 'Actions for {{code}}', { code: r.code })} items={items} />
              </li>
            );
          })}
          {remainder && (
            <li data-testid="wo-section-remainder" className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-muted-foreground">
              <div className="min-w-0 flex-[1_1_14rem]">
                <div>{t('remainder', 'Not in a {{section}}', vars)}</div>
                {figures(remainder).length > 0 && <div className="text-control flex flex-wrap gap-x-3">{figures(remainder)}</div>}
              </div>
              {showPlan && <div className="tabular-nums text-control" data-testid="wo-section-plan-remainder"><span>{t('planned', 'Planned')} </span>{money(remainder.directBudget)}</div>}
            </li>
          )}
        </ul>
      )}
      {editing && (
        <SectionFormModal workOrderId={workOrder.id} section={editing === 'new' ? null : editing}
          nextOrder={sections.reduce((n, r) => Math.max(n, r.sortOrder ?? 0), 0) + 1} foremanNames={names} onClose={() => setEditing(null)} />
      )}
      {sections.length > 0 && <SectionMaterialCheck workOrderId={workOrder.id} sections={sections.map((x) => ({ id: x.sectionId as string, code: x.code as string }))} />}
      {materialFor && <SectionMaterialModal workOrderId={workOrder.id} section={materialFor} onClose={() => setMaterialFor(null)} />}
      {planning && <SectionPlanModal projectId={workOrder.project_id} workOrderId={workOrder.id} currency={workOrder.currency} section={planning} onClose={() => setPlanning(null)} />}
      {readinessFor && (
        <SectionReadinessModal workOrderId={workOrder.id} section={readinessFor} names={names} onClose={() => setReadinessFor(null)}
          canSet={may('set_readiness', 'workOrderSection', { ...base, record: { ...base.record, foreman_id: readinessFor.foremanId } }) && readinessFor.archivedAt === null} />
      )}
      <ConfirmDialog open={archiving !== null} title={t('archiveTitle', 'Archive {{code}}', { code: archiving?.code ?? '' })}
        description={t('archiveBody', 'It stops being offered on new records. Records already on it keep it.')}
        confirmLabel={t('archiveConfirm', 'Archive')} loading={archive.isPending}
        onConfirm={() => archiving && void doArchive(archiving, true)} onCancel={() => setArchiving(null)} />
      <ConfirmDialog open={deleting !== null} tone="destructive" title={t('deleteTitle', 'Delete {{code}}', { code: deleting?.code ?? '' })}
        description={t('deleteBody', 'This removes it for good. It is blocked while any record uses it.')}
        confirmLabel={t('deleteConfirm', 'Delete')} loading={remove.isPending}
        onConfirm={() => deleting && void doDelete(deleting)} onCancel={() => setDeleting(null)} />
    </RecordSection>
  );
};
