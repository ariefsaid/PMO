import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Card, CardHead, CardPad, Combobox, ConfirmDialog, DataTable, Drawer, Icon, ListState, ProgressBar, StatusPill, useToast, useUrlFilters,
  type Column, type ComboboxOption,
} from '@/src/components/ui';
import { useCanManageManpower, useManpowerLinks, useManpowerMutations, useManpowerNeeds, useManpowerProgress } from '@/src/hooks/useManpowerNeeds';
import { useCostDisciplines } from '@/src/hooks/useWorkOrderCosts';
import { useProjectPickerOptions } from '@/src/hooks/useProjects';
import { usePeople } from '@/src/hooks/usePeople';
import type { ManpowerNeedRow, ManpowerProgressRow } from '@/src/lib/repositories/manpowerNeeds';
import { formatDay } from '@/src/lib/format';
import { ManpowerNeedForm } from './ManpowerNeedForm';
import { useManpowerErrorText } from './manpowerErrors';

const statusLabel = (t: (k: string, d: string) => string, s: ManpowerNeedRow['status']) =>
  s === 'open' ? t('crews:manpower.status.open', 'Open') : s === 'met' ? t('crews:manpower.status.met', 'Met') : t('crews:manpower.status.cancelled', 'Cancelled');
const statusVariant = { open: 'open', met: 'won', cancelled: 'lost' } as const;

interface Figures { asked: number; filled: number | '—'; inProgress: number | '—'; open: number | '—'; hidden: boolean }

/** The four counts of one need, from the database's progress read. Unknown (read failed) or hidden is a dash, never a made-up zero. */
const figuresOf = (need: ManpowerNeedRow, progress: ManpowerProgressRow | undefined, readFailed: boolean): Figures => {
  // filled and in progress are null where the database does not show this person who is cleared.
  const hidden = progress !== undefined && (progress.filled === null || progress.in_progress === null);
  const dash = hidden || readFailed;
  return {
    asked: progress?.asked ?? need.headcount,
    filled: dash ? '—' : progress?.filled ?? 0,
    inProgress: dash ? '—' : progress?.in_progress ?? 0,
    open: readFailed ? '—' : progress?.open_count ?? need.headcount,
    hidden,
  };
};

/** The progress or links read failed: one line and Retry, wherever the counts are shown. */
const ReadFailed: React.FC<{ onRetry: () => void; className?: string }> = ({ onRetry, className }) => {
  const { t } = useTranslation('crews');
  return (
    <div className={`flex flex-wrap items-center gap-3 text-sm text-foreground ${className ?? ''}`}>
      <span role="alert">{t('crews:manpower.readError', "Couldn't load progress or linked people")}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>{t('crews:retry', 'Retry')}</Button>
    </div>
  );
};

interface DrawerProps {
  need: ManpowerNeedRow;
  figures: Figures;
  readFailed: boolean;
  title: string;
  links: { id: string; personId: string; name: string }[];
  peopleOptions: ComboboxOption[];
  canManage: boolean;
  onRetry: () => void;
  onClose: () => void;
}

/** One need opened from its row: how far it is filled, the people linked, and the writer's controls. */
const NeedDrawer: React.FC<DrawerProps> = ({ need, figures, readFailed, title, links, peopleOptions, canManage, onRetry, onClose }) => {
  const { t } = useTranslation('crews');
  const writeError = useManpowerErrorText();
  const { toast } = useToast();
  const { link, unlink, update } = useManpowerMutations();
  const [cancelling, setCancelling] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (job: () => Promise<unknown>, done: string) => {
    setProblem(null);
    try { await job(); toast(done, undefined, 'success'); } catch (err) { setProblem(writeError(err)); }
  };
  const { asked, filled, inProgress, open } = figures;
  const linkable = peopleOptions.filter((o) => !links.some((l) => l.personId === o.value));
  const canLink = canManage && !readFailed && need.status === 'open' && links.length < need.headcount;
  const readyToClose = need.status === 'open' && open === 0 && inProgress === 0;
  return (
    <Drawer open onClose={onClose} nestedOpen={cancelling} title={title}
      subtitle={`${t('crews:manpower.neededByOn', 'Needed by {{date}}', { date: formatDay(need.needed_by) })}${need.note ? ` · ${need.note}` : ''}`}
      status={<StatusPill variant={statusVariant[need.status]}>{statusLabel(t, need.status)}</StatusPill>}
      footer={canManage ? (
        <div className="flex flex-wrap justify-end gap-2">
          {need.status === 'open' && <Button variant="ghost" onClick={() => setCancelling(true)}>{t('crews:manpower.cancel', 'Cancel need')}</Button>}
          {need.status === 'open' && (
            <Button variant="primary" disabled={!readyToClose}
              title={readyToClose ? undefined : t('crews:manpower.markMetWhy', 'Available once every place has a cleared person.')}
              onClick={() => void run(() => update.mutateAsync({ id: need.id, patch: { status: 'met' } }), t('crews:manpower.markedMet', 'Marked as met'))}>
              {t('crews:manpower.markMet', 'Mark as met')}
            </Button>
          )}
          {need.status !== 'open' && (
            <Button variant="outline" onClick={() => void run(() => update.mutateAsync({ id: need.id, patch: { status: 'open' } }), t('crews:manpower.reopened', 'Need reopened'))}>
              {t('crews:manpower.reopen', 'Reopen')}
            </Button>
          )}
        </div>
      ) : undefined}>
      <div data-testid={`manpower-need-${need.id}`} className="space-y-6">
        {problem && <p role="alert" className="text-sm text-destructive-text">{problem}</p>}
        {readFailed && <ReadFailed onRetry={onRetry} />}
        <section aria-label={t('crews:manpower.progressTitle', 'Progress')}>
          {typeof filled === 'number' && filled > 0 && (
            <ProgressBar widthless className="w-full" value={asked > 0 ? (filled / asked) * 100 : 0} tone="success"
              aria-label={t('crews:manpower.progressLabel', '{{filled}} of {{asked}} filled', { filled, asked })} />
          )}
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
            {([[t('crews:manpower.asked', 'Asked'), asked], [t('crews:manpower.filled', 'Filled'), filled],
              [t('crews:manpower.inProgress', 'In progress'), inProgress], [t('crews:manpower.toFill', 'To fill'), open]] as const).map(([label, n]) => (
              <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="text-xl font-semibold tabular-nums text-foreground">{n}</dd></div>
            ))}
          </dl>
        </section>
        <section aria-label={t('crews:manpower.people', 'People linked')}>
          <h3 className="mb-3 text-base font-semibold text-foreground">{t('crews:manpower.people', 'People linked')}</h3>
          {links.length === 0
            ? <p className="text-sm text-muted-foreground">{t('crews:manpower.nobodyLinked', 'Nobody linked yet')}</p>
            : (
              <ul className="divide-y divide-border border-y border-border">
                {links.map((l) => (
                  <li key={l.id} className="flex min-h-11 items-center justify-between gap-3 text-sm">
                    <span className="text-foreground">{l.name}</span>
                    {canManage && need.status === 'open' && (
                      <Button variant="ghost" size="icon" aria-label={t('crews:manpower.unlinkNamed', 'Unlink {{name}}', { name: l.name })}
                        onClick={() => void run(() => unlink.mutateAsync(l.id), t('crews:manpower.unlinked', 'Person unlinked'))}>
                        <Icon name="x" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          {canLink && (
            <div className="mt-4">
              <Combobox id={`manpower-link-${need.id}`} label={t('crews:manpower.linkPerson', 'Link a person')} value={null}
                loadOptions={async () => linkable} onChange={(v) => void run(() => link.mutateAsync({ needId: need.id, personId: v }), t('crews:manpower.linked', 'Person linked'))}
                noun={t('crews:personNoun', 'person')} nounPlural={t('crews:personNounPlural', 'people')} />
            </div>
          )}
          {need.status === 'open' && !canLink && !readFailed && links.length >= need.headcount && (
            <p className="mt-3 text-sm text-muted-foreground">{t('crews:manpower.allLinked', 'All places have a person. Raise the head count to link more.')}</p>
          )}
        </section>
      </div>
      <ConfirmDialog open={cancelling} title={t('crews:manpower.cancelTitle', 'Cancel this need?')}
        description={t('crews:manpower.cancelBody', 'The people linked stay on record. You can reopen the need later.')}
        confirmLabel={t('crews:manpower.cancel', 'Cancel need')} onCancel={() => setCancelling(false)}
        onConfirm={() => { setCancelling(false); void run(() => update.mutateAsync({ id: need.id, patch: { status: 'cancelled' } }), t('crews:manpower.cancelled', 'Need cancelled')); }} />
    </Drawer>
  );
};

/**
 * Manpower needs (docs/specs/manpower-request.spec.md): the positions and head counts a site needs by a date, and how far each is filled.
 * One row per need (position, project, date, the four counts, status); the row opens the need in a side drawer with the people and actions.
 * "Filled" is read from the cleared-for-site checklist by the database, never computed here. Writes are for those the database says may
 * write (`manpower_can_manage`); everyone else reads.
 */
export const ManpowerNeeds: React.FC = () => {
  const { t } = useTranslation('crews');
  const needs = useManpowerNeeds();
  const progress = useManpowerProgress();
  const linksQ = useManpowerLinks();
  const positions = useCostDisciplines();
  const projects = useProjectPickerOptions();
  const people = usePeople();
  const can = useCanManageManpower();
  const canManage = can.data === true;
  const { values, setFilter } = useUrlFilters(['need']);
  const [creating, setCreating] = useState(false);
  const progressBy = useMemo(() => new Map((progress.data ?? []).map((p) => [p.need_id, p])), [progress.data]);
  const peopleById = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p.name])), [people.data]);
  const peopleOptions: ComboboxOption[] = useMemo(() => (people.data ?? []).map((p) => ({ value: p.id, label: p.name })), [people.data]);
  const linksBy = useMemo(() => {
    const m = new Map<string, { id: string; personId: string; name: string }[]>();
    for (const l of linksQ.data ?? []) m.set(l.need_id, [...(m.get(l.need_id) ?? []), { id: l.id, personId: l.person_id, name: peopleById.get(l.person_id) ?? '—' }]);
    return m;
  }, [linksQ.data, peopleById]);
  // A need can point at a position or project that is no longer listed (archived): say so, never a bare dash.
  const positionName = (id: string) => positions.data?.find((d) => d.id === id)?.name ?? t('crews:manpower.positionGone', 'Position no longer listed');
  const projectName = (id: string) => projects.data?.find((p) => p.id === id)?.name ?? t('crews:manpower.projectGone', 'Project no longer listed');
  const rows = needs.data ?? [];
  const readFailed = progress.isError || linksQ.isError;
  const retryReads = () => { if (progress.isError) void progress.refetch(); if (linksQ.isError) void linksQ.refetch(); };
  const fig = (n: ManpowerNeedRow) => figuresOf(n, progressBy.get(n.id), readFailed || progress.isPending || linksQ.isPending);
  const anyHidden = !readFailed && rows.some((n) => fig(n).hidden);
  const openNeed = rows.find((n) => n.id === values.need) ?? null;
  const columns: Column<ManpowerNeedRow>[] = [
    { key: 'position', header: t('crews:manpower.position', 'Position'), kind: 'primary', rowHeader: true, cell: (n) => positionName(n.discipline_id),
      secondaryCell: (n) => projectName(n.project_id) },
    { key: 'needed', header: t('crews:manpower.neededByColumn', 'Needed by'), kind: 'date', size: 168, cell: (n) => formatDay(n.needed_by) },
    { key: 'asked', size: 120, header: t('crews:manpower.asked', 'Asked'), kind: 'number', cell: (n) => fig(n).asked },
    { key: 'filled', size: 120, header: t('crews:manpower.filled', 'Filled'), kind: 'number', cell: (n) => fig(n).filled },
    { key: 'inProgress', size: 120, header: t('crews:manpower.inProgress', 'In progress'), kind: 'number', cell: (n) => fig(n).inProgress },
    { key: 'open', size: 120, header: t('crews:manpower.toFill', 'To fill'), kind: 'number', cell: (n) => fig(n).open },
    { key: 'status', header: t('crews:statusHeader', 'Status'), kind: 'status', size: 112, cell: (n) => <StatusPill variant={statusVariant[n.status]}>{statusLabel(t, n.status)}</StatusPill> },
  ];
  return (
    <section data-testid="manpower-needs" aria-labelledby="manpower-title">
      <Card seam>
        <CardHead id="manpower-title" actions={canManage ? <Button variant="outline" size="sm" onClick={() => setCreating(true)}><Icon name="plus" />{t('crews:manpower.new', 'Record a need')}</Button> : undefined}>
          {t('crews:manpower.title', 'Manpower needs')}
        </CardHead>
        {readFailed && <ReadFailed onRetry={retryReads} className="border-b border-border px-4 py-3" />}
        {needs.isPending ? <CardPad><ListState variant="loading" shape="table" rows={3} /></CardPad> : needs.isError ? (
          <CardPad><ListState variant="error" title={t('crews:manpower.error', "Couldn't load manpower needs")} onRetry={() => void needs.refetch()} retryLabel={t('crews:retry', 'Retry')} /></CardPad>
        ) : (
          <DataTable<ManpowerNeedRow> embedded rows={rows} columns={columns} rowKey={(n) => n.id} tableId="manpower-needs-table"
            onActivate={(n) => setFilter('need', n.id)} selectedKey={openNeed?.id} cardBelow={1000}
            mobileCardDetails={(n) => {
              const f = fig(n);
              return (
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3 text-muted-foreground">
                    <span className="min-w-0">{t('crews:manpower.neededByOn', 'Needed by {{date}}', { date: formatDay(n.needed_by) })}</span>
                    <span className="shrink-0"><StatusPill variant={statusVariant[n.status]}>{statusLabel(t, n.status)}</StatusPill></span>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                    {([[t('crews:manpower.asked', 'Asked'), f.asked], [t('crews:manpower.filled', 'Filled'), f.filled],
                      [t('crews:manpower.inProgress', 'In progress'), f.inProgress], [t('crews:manpower.toFill', 'To fill'), f.open]] as const).map(([label, v]) => (
                      <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums text-foreground">{v}</dd></div>
                    ))}
                  </dl>
                </div>
              );
            }}
            rowLabel={(n) => t('crews:manpower.openRow', 'Open the need for {{position}}', { position: positionName(n.discipline_id) })}
            state={rows.length === 0 ? 'empty' : undefined}
            emptyTitle={t('crews:manpower.empty', 'No manpower needs yet')}
            emptySub={canManage ? undefined : t('crews:manpower.emptyReader', 'A project manager or the people team records the positions a site needs.')}
            emptyAction={canManage ? { label: t('crews:manpower.new', 'Record a need'), onClick: () => setCreating(true) } : undefined}
            emptyActionVariant="outline" />
        )}
        {anyHidden && <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">{t('crews:manpower.countsHidden', 'Filled and in progress are shown to the people team and to the roles that read the clearance checklist.')}</p>}
      </Card>
      {openNeed && (
        <NeedDrawer key={openNeed.id} need={openNeed} figures={fig(openNeed)} readFailed={readFailed}
          title={`${positionName(openNeed.discipline_id)} · ${projectName(openNeed.project_id)}`}
          links={linksBy.get(openNeed.id) ?? []} peopleOptions={peopleOptions} canManage={canManage} onRetry={retryReads} onClose={() => setFilter('need', '')} />
      )}
      {creating && <ManpowerNeedForm onClose={() => setCreating(false)} />}
    </section>
  );
};
