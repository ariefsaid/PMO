import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, Combobox, ConfirmDialog, Icon, ListState, ProgressBar, StatusPill, useToast, type ComboboxOption } from '@/src/components/ui';
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

interface CardProps {
  need: ManpowerNeedRow;
  progress: ManpowerProgressRow | undefined;
  position: string;
  project: string;
  links: { id: string; personId: string; name: string }[];
  peopleOptions: ComboboxOption[];
  canManage: boolean;
  onProblem: (message: string | null) => void;
}

/** One need: asked, filled, in progress and open from the database's progress read, the linked people, and the writer's controls. */
const NeedCard: React.FC<CardProps> = ({ need, progress, position, project, links, peopleOptions, canManage, onProblem }) => {
  const { t } = useTranslation('crews');
  const writeError = useManpowerErrorText();
  const { toast } = useToast();
  const { link, unlink, update } = useManpowerMutations();
  const [cancelling, setCancelling] = useState(false);
  const run = async (job: () => Promise<unknown>, done: string) => {
    onProblem(null);
    try { await job(); toast(done, undefined, 'success'); } catch (err) { onProblem(writeError(err)); }
  };
  const asked = progress?.asked ?? need.headcount;
  const filled = progress?.filled ?? 0;
  const inProgress = progress?.in_progress ?? 0;
  const open = progress?.open_count ?? need.headcount;
  const linkable = peopleOptions.filter((o) => !links.some((l) => l.personId === o.value));
  const canLink = canManage && need.status === 'open' && links.length < need.headcount;
  const readyToClose = need.status === 'open' && open === 0 && inProgress === 0;
  return (
    <Card data-testid={`manpower-need-${need.id}`}>
      <CardHead actions={<StatusPill variant={statusVariant[need.status]}>{statusLabel(t, need.status)}</StatusPill>}>
        {position} · {project}
      </CardHead>
      <CardPad>
        <p className="text-sm text-muted-foreground">{t('crews:manpower.neededByOn', 'Needed by {{date}}', { date: formatDay(need.needed_by) })}{need.note ? ` · ${need.note}` : ''}</p>
        <div className="mt-3">
          <ProgressBar value={asked > 0 ? (filled / asked) * 100 : 0} tone="success"
            aria-label={t('crews:manpower.progressLabel', '{{filled}} of {{asked}} filled', { filled, asked })} />
          <dl className="mt-2 grid grid-cols-4 gap-2 text-sm">
            {[
              [t('crews:manpower.asked', 'Asked'), asked], [t('crews:manpower.filled', 'Filled'), filled],
              [t('crews:manpower.inProgress', 'In progress'), inProgress], [t('crews:manpower.open', 'Open'), open],
            ].map(([label, n]) => (
              <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="tabular-nums font-medium">{n}</dd></div>
            ))}
          </dl>
        </div>
        {links.length > 0 && (
          <ul className="mt-3 divide-y divide-border" aria-label={t('crews:manpower.people', 'People linked')}>
            {links.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-1.5 text-sm">
                <span>{l.name}</span>
                {canManage && need.status === 'open' && (
                  <Button variant="ghost" size="sm" aria-label={t('crews:manpower.unlinkNamed', 'Unlink {{name}}', { name: l.name })}
                    onClick={() => void run(() => unlink.mutateAsync(l.id), t('crews:manpower.unlinked', 'Person unlinked'))}>
                    <Icon name="x" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canLink && (
          <div className="mt-3 max-w-sm">
            <Combobox id={`manpower-link-${need.id}`} label={t('crews:manpower.linkPerson', 'Link a person')} value={null}
              loadOptions={async () => linkable} onChange={(v) => void run(() => link.mutateAsync({ needId: need.id, personId: v }), t('crews:manpower.linked', 'Person linked'))}
              noun={t('crews:personNoun', 'person')} nounPlural={t('crews:personNounPlural', 'people')} />
          </div>
        )}
        {need.status === 'open' && !canLink && links.length >= need.headcount && (
          <p className="mt-3 text-sm text-muted-foreground">{t('crews:manpower.allLinked', 'All places have a person. Raise the head count to link more.')}</p>
        )}
        {canManage && (
          <div className="mt-3 flex flex-wrap gap-2">
            {need.status === 'open' && (
              <Button variant={readyToClose ? 'primary' : 'outline'} size="sm" disabled={!readyToClose}
                title={readyToClose ? undefined : t('crews:manpower.markMetWhy', 'Available once every place has a cleared person.')}
                onClick={() => void run(() => update.mutateAsync({ id: need.id, patch: { status: 'met' } }), t('crews:manpower.markedMet', 'Marked as met'))}>
                {t('crews:manpower.markMet', 'Mark as met')}
              </Button>
            )}
            {need.status === 'open' && <Button variant="outline" size="sm" onClick={() => setCancelling(true)}>{t('crews:manpower.cancel', 'Cancel need')}</Button>}
            {need.status !== 'open' && (
              <Button variant="outline" size="sm" onClick={() => void run(() => update.mutateAsync({ id: need.id, patch: { status: 'open' } }), t('crews:manpower.reopened', 'Need reopened'))}>
                {t('crews:manpower.reopen', 'Reopen')}
              </Button>
            )}
          </div>
        )}
      </CardPad>
      <ConfirmDialog open={cancelling} title={t('crews:manpower.cancelTitle', 'Cancel this need?')}
        description={t('crews:manpower.cancelBody', 'The people linked stay on record. You can reopen the need later.')}
        confirmLabel={t('crews:manpower.cancel', 'Cancel need')} onCancel={() => setCancelling(false)}
        onConfirm={() => { setCancelling(false); void run(() => update.mutateAsync({ id: need.id, patch: { status: 'cancelled' } }), t('crews:manpower.cancelled', 'Need cancelled')); }} />
    </Card>
  );
};

/**
 * Manpower needs (docs/specs/manpower-request.spec.md): the positions and head counts a site needs by a date, and how far each is filled.
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
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const progressBy = useMemo(() => new Map((progress.data ?? []).map((p) => [p.need_id, p])), [progress.data]);
  const peopleById = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p.name])), [people.data]);
  const peopleOptions: ComboboxOption[] = useMemo(() => (people.data ?? []).map((p) => ({ value: p.id, label: p.name })), [people.data]);
  const linksBy = useMemo(() => {
    const m = new Map<string, { id: string; personId: string; name: string }[]>();
    for (const l of linksQ.data ?? []) m.set(l.need_id, [...(m.get(l.need_id) ?? []), { id: l.id, personId: l.person_id, name: peopleById.get(l.person_id) ?? '—' }]);
    return m;
  }, [linksQ.data, peopleById]);
  const positionName = (id: string) => positions.data?.find((d) => d.id === id)?.name ?? '—';
  const projectName = (id: string) => projects.data?.find((p) => p.id === id)?.name ?? '—';
  const rows = needs.data ?? [];
  return (
    <section data-testid="manpower-needs" aria-label={t('crews:manpower.title', 'Manpower needs')}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{t('crews:manpower.title', 'Manpower needs')}</h2>
        {canManage && <Button variant="primary" size="sm" onClick={() => setCreating(true)}><Icon name="plus" />{t('crews:manpower.new', 'Record a need')}</Button>}
      </div>
      {problem && <p role="alert" className="mb-3 text-sm text-destructive-text">{problem}</p>}
      {needs.isPending ? <ListState variant="loading" shape="table" rows={3} /> : needs.isError ? (
        <ListState variant="error" title={t('crews:manpower.error', "Couldn't load manpower needs")} onRetry={() => void needs.refetch()} retryLabel={t('crews:retry', 'Retry')} />
      ) : rows.length === 0 ? (
        <ListState variant="empty" title={t('crews:manpower.empty', 'No manpower needs yet')}
          sub={canManage ? t('crews:manpower.emptyWriter', 'Record the positions a site needs and by when.')
            : t('crews:manpower.emptyReader', 'A project manager or the people team records the positions a site needs.')} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((n) => (
            <NeedCard key={n.id} need={n} progress={progressBy.get(n.id)} position={positionName(n.discipline_id)} project={projectName(n.project_id)}
              links={linksBy.get(n.id) ?? []} peopleOptions={peopleOptions} canManage={canManage} onProblem={setProblem} />
          ))}
        </div>
      )}
      {creating && <ManpowerNeedForm onClose={() => setCreating(false)} />}
    </section>
  );
};
