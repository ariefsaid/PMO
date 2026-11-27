import React from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Icon, ListState, PageHeader, SelectField } from '@/src/components/ui';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import { PaginationFooter } from '@/src/components/ui/PaginationFooter';
import { parsePageParam, useClampPage } from '@/src/components/ui/usePageParam';
import { useMaterialRollup, useOrderNumbers, useSectionStages } from '@/src/hooks/useOwnerMaterial';
import { useWorkOrderProjectChoices } from '@/src/hooks/useWorkOrderProjectChoices';
import { MATERIAL_PAGE_SIZE, type MaterialRollupRow } from '@/src/lib/repositories/ownerMaterial';
import { useTerms } from '@/src/lib/i18n/terms';
import { isDenied, locationLabel, pct } from '@/src/lib/ownerMaterialFormat';

const th = 'sticky top-0 z-10 bg-card px-[var(--table-cell-inset)] py-2 align-bottom text-control font-normal text-muted-foreground';
const td = 'px-[var(--table-cell-inset)] py-2 align-top';

/**
 * The Materials view of Work Orders (#3010): one row per work order of a project with the server's stage percentages
 * (requested, owner set-aside, received, issued, closing) and its conservative reconciliation step; a row opens its
 * locations with each location's step and a link to its stages. Nothing here is computed in the browser, and no
 * quantity is totalled across units (the rollup carries percentages only). One page request per page, paged by the address.
 */
export const OwnerMaterialRollup: React.FC = () => {
  const { t } = useTranslation('ownerMaterial');
  const terms = useTerms();
  const [params, setParams] = useSearchParams();
  const choices = useWorkOrderProjectChoices(true);
  // The project in the address, else the only one the reader can see; with several and none chosen, the reader is asked.
  const projectId = (choices.data ?? []).find((p) => p.value === params.get('project'))?.value ?? (choices.data?.length === 1 ? choices.data[0].value : undefined);
  const page = parsePageParam(params.get('mpage') ?? '');
  const edit = (fn: (n: URLSearchParams) => void, options?: { replace: boolean }) => setParams((c) => { const n = new URLSearchParams(c); fn(n); return n; }, options);
  const setPage = (next: number, options?: { replace: boolean }) => edit((n) => { if (next > 1) n.set('mpage', String(next)); else n.delete('mpage'); }, options);
  const q = useMaterialRollup(projectId, page);
  useClampPage(page, q.data?.total, MATERIAL_PAGE_SIZE, setPage);
  // The rollup carries one number per work order; people know an order by the owner's number, so both are read for the page.
  const numbers = useOrderNumbers((q.data?.rows ?? []).map((r) => r.workOrderId));
  const names = (r: MaterialRollupRow): OrderNames => orderNames(r, numbers.data?.find((n) => n.workOrderId === r.workOrderId));
  const open = params.get('open');
  const wide = useIsDesktop();
  const toggle = (id: string) => edit((n) => { if (open === id) n.delete('open'); else n.set('open', id); });

  let body: React.ReactNode;
  if (choices.isError) body = <ListState variant="error" title={t('rollup.error', "Couldn't load the material rollup")} onRetry={() => void choices.refetch()} />;
  else if (choices.isSuccess && !projectId) body = <p className="p-[var(--panel-inset)] text-control text-muted-foreground" data-testid="omr-choose">{choices.data.length ? t('rollup.chooseProject', 'Choose a project to see its material.') : t('rollup.noProject', 'No project to show.')}</p>;
  else if (choices.isPending || q.isPending) body = <div className="p-[var(--panel-inset)]"><ListState variant="loading" rows={5} /></div>;
  else if (q.isError && isDenied(q.error)) body = <p role="alert" className="p-[var(--panel-inset)] text-control text-muted-foreground" data-testid="omr-denied">{t('rollup.denied', "You can't view the material rollup.")}</p>;
  else if (q.isError) body = <div className="p-[var(--panel-inset)]"><ListState variant="error" title={t('rollup.error', "Couldn't load the material rollup")} onRetry={() => void q.refetch()} /></div>;
  else if (q.data.total === 0) body = <p className="p-[var(--panel-inset)] text-control text-muted-foreground" data-testid="omr-empty">{t('rollup.empty', 'No work order of this project has material planned.')}</p>;
  else body = (
    <>
      {!wide ? (
        <ul className="divide-y divide-border/70" data-testid="omr-cards" aria-label={t('rollup.tableLabel', 'Material progress by work order')}>
          {q.data.rows.map((r) => <RollupCard key={r.workOrderId} row={r} names={names(r)} expanded={open === r.workOrderId} onToggle={() => toggle(r.workOrderId)} />)}
        </ul>
      ) : (
      <div className="max-h-[calc(100vh-14rem)] overflow-auto" tabIndex={0} role="region" aria-label={t('rollup.tableLabel', 'Material progress by work order')}>
        <table className="w-full min-w-[880px] border-collapse text-left" data-testid="omr-table">
          <thead>
            <tr className="border-b border-border/70">
              <th scope="col" className={`${th} left-0 z-20`}>{t('rollup.workOrder', 'Work order')}</th>
              <th scope="col" className={`${th} text-right`}>{t('rollup.sections', 'Locations')}</th>
              <th scope="col" className={`${th} text-right`}>{t('col.requested', 'Requested')}</th>
              <th scope="col" className={`${th} text-right`}>{t('col.setAside', 'Owner set-aside')}</th>
              <th scope="col" className={`${th} text-right`}>{t('col.received', 'Received')}</th>
              <th scope="col" className={`${th} text-right`}>{t('col.issued', 'Issued')}</th>
              <th scope="col" className={`${th} text-right`}>{t('col.closing', 'Closing stock')}</th>
              <th scope="col" className={th}>{t('reconciliation', 'Material reconciliation')}</th>
            </tr>
          </thead>
          <tbody>
            {q.data.rows.map((r) => (
              <RollupRow key={r.workOrderId} row={r} names={names(r)} expanded={open === r.workOrderId}
                onToggle={() => toggle(r.workOrderId)} />
            ))}
          </tbody>
        </table>
      </div>
      )}
      <PaginationFooter pagination={{ page, pageSize: MATERIAL_PAGE_SIZE, onPageChange: (p) => setPage(p) }} total={q.data.total} shown={q.data.rows.length} />
    </>
  );

  return (
    <>
      <PageHeader title={terms.clientWorkOrder} />
      {(choices.data?.length ?? 0) > 1 && (
        <div className="mb-4 w-full sm:w-72">
          <SelectField label={t('rollup.project', 'Project')} hideLabel value={projectId ?? ''} placeholder={t('rollup.chooseProjectShort', 'Choose a project')} data-testid="omr-project"
            onChange={(v) => edit((n) => { n.set('project', v); n.delete('mpage'); n.delete('open'); })} options={(choices.data ?? []).map((p) => ({ value: p.value, label: p.label }))} />
        </div>
      )}
      <section className="panel-card overflow-hidden" aria-label={t('rollup.title', 'Materials')} data-testid="owner-material-rollup">{body}</section>
    </>
  );
};

interface OrderNames { label: string; ours: string | null }
/** The owner's order number leads; our own number follows when it is a different one. Without the number read, the rollup's own. */
const orderNames = (row: MaterialRollupRow, n: { clientPoNumber: string | null; woNumber: string | null } | undefined): OrderNames => {
  const label = n?.clientPoNumber ?? row.number ?? row.title;
  return { label, ours: n?.woNumber && n.woNumber !== label ? n.woNumber : null };
};

/** What the unplaced-movements count is, plainly: stock movements of this work order that no location's figures include. */
const Unplaced: React.FC<{ n: number }> = ({ n }) => {
  const { t } = useTranslation('ownerMaterial');
  return n > 0 ? <span className="block text-control text-muted-foreground" data-testid="omr-unplaced">{t('rollup.unallocated', { count: n, defaultValue_one: '{{count}} stock movement is in no location\'s figures', defaultValue_other: '{{count}} stock movements are in no location\'s figures' })}</span> : null;
};

const Identity: React.FC<{ row: MaterialRollupRow; names: OrderNames }> = ({ row, names }) => (
  <>
    <span className="block font-medium text-foreground" data-testid="omr-order-number">{names.label}</span>
    {names.ours && <span className="block text-control text-muted-foreground" data-testid="omr-own-number">{names.ours}</span>}
    <span className="block text-control text-muted-foreground">{row.title}</span>
  </>
);

const RollupRow: React.FC<{ row: MaterialRollupRow; names: OrderNames; expanded: boolean; onToggle: () => void }> = ({ row, names, expanded, onToggle }) => {
  const { t } = useTranslation('ownerMaterial');
  const label = names.label;
  const cell = `${td} text-right tabular-nums`;
  return (
    <>
      <tr className="border-b border-border/70" data-testid={`omr-row-${row.workOrderId}`}>
        <th scope="row" className={`${td} sticky left-0 bg-card text-left font-normal`}>
          <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex min-h-8 w-full items-start gap-2 text-left focus-visible:outline-2 focus-visible:outline-ring"
            aria-label={expanded ? t('rollup.collapse', 'Hide locations of {{wo}}', { wo: label }) : t('rollup.expand', 'Locations of {{wo}}', { wo: label })}>
            <Icon name="chev" aria-hidden className={`mt-1 size-3.5 shrink-0 ${expanded ? 'rotate-90' : ''}`} />
            <span className="min-w-0">
              <Identity row={row} names={names} />
              <Unplaced n={row.unallocatedMovementCount} />
            </span>
          </button>
        </th>
        <td className={cell} data-testid="omr-sections">{row.sectionCount}</td>
        <td className={cell} data-testid="omr-requested">{pct(row.requestedPct)}</td>
        <td className={cell} data-testid="omr-set-aside">{pct(row.setAsidePct)}</td>
        <td className={cell} data-testid="omr-received">{pct(row.receivedPct)}</td>
        <td className={cell} data-testid="omr-issued">{pct(row.issuedPct)}</td>
        <td className={cell} data-testid="omr-closing">{pct(row.closingPct)}</td>
        <td className={td} data-testid="omr-step">{row.reconciliationStep ? `${row.reconciliationStep} · ${pct(row.reconciliationPct)}` : '—'}</td>
      </tr>
      {expanded && <Locations workOrderId={row.workOrderId} />}
    </>
  );
};

/** The work order's locations as rows under it, in the same columns: each location's own server percentages and step. */
const Locations: React.FC<{ workOrderId: string }> = ({ workOrderId }) => {
  const { t } = useTranslation('ownerMaterial');
  const sections = useSectionStages(workOrderId);
  const note = (node: React.ReactNode) => <tr className="border-b border-border/70"><td colSpan={8} className="px-[var(--table-cell-inset)] py-2">{node}</td></tr>;
  if (sections.isPending) return note(<ListState variant="loading" rows={2} />);
  if (sections.isError) return note(<ListState variant="error" title={t('rollup.locationsError', "Couldn't load the locations")} onRetry={() => void sections.refetch()} />);
  if (sections.data.length === 0) return note(<span className="text-control text-muted-foreground">{t('rollup.noLocations', 'No locations yet.')}</span>);
  const cell = `${td} text-right tabular-nums`;
  return (
    <>
      {sections.data.map((s) => (
        <tr key={s.sectionId} className="border-b border-border/70" data-testid={`omr-location-${s.sectionId}`}>
          <th scope="row" className={`${td} sticky left-0 bg-card text-left font-normal`}>
            <span className="block pl-6 text-foreground">{locationLabel(s.code, s.name)}</span>
            <Link to={`/work-orders/${workOrderId}?section=${s.sectionId}#wo-material`} className="inline-flex min-h-8 items-center pl-6 text-control text-primary-text hover:underline">
              {t('rollup.openStages', 'Open stages')}
            </Link>
          </th>
          <td className={cell} data-testid="omr-loc-lines">{t('rollup.lines', { count: s.lineCount, defaultValue_one: '{{count}} line', defaultValue_other: '{{count}} lines' })}</td>
          <td className={cell} data-testid="omr-loc-requested">{pct(s.requestedPct)}</td>
          <td className={cell}>{pct(s.setAsidePct)}</td>
          <td className={cell} data-testid="omr-loc-received">{pct(s.receivedPct)}</td>
          <td className={cell}>{pct(s.issuedPct)}</td>
          <td className={cell}>{pct(s.closingPct)}</td>
          <td className={td} data-testid="omr-location-step">{s.step ? `${s.step} · ${pct(s.stepPct)}` : t('notStarted', 'Not started')}</td>
        </tr>
      ))}
    </>
  );
};

type Stages = { requestedPct: string | null; setAsidePct: string | null; receivedPct: string | null; issuedPct: string | null; closingPct: string | null };
const StageList: React.FC<{ s: Stages; step: string; testPrefix: string }> = ({ s, step, testPrefix }) => {
  const { t } = useTranslation('ownerMaterial');
  const items: [string, string, string][] = [
    ['requested', t('col.requested', 'Requested'), pct(s.requestedPct)], ['set-aside', t('col.setAside', 'Owner set-aside'), pct(s.setAsidePct)],
    ['received', t('col.received', 'Received'), pct(s.receivedPct)], ['issued', t('col.issued', 'Issued'), pct(s.issuedPct)],
    ['closing', t('col.closing', 'Closing stock'), pct(s.closingPct)], ['step', t('reconciliation', 'Material reconciliation'), step],
  ];
  return (
    <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-control">
      {items.map(([k, label, v]) => <React.Fragment key={k}><dt className="text-muted-foreground">{label}</dt><dd className="text-right tabular-nums" data-testid={`${testPrefix}${k}`}>{v}</dd></React.Fragment>)}
    </dl>
  );
};

/** Phone: one card per work order, its locations as nested cards; the same server figures as the table. */
const RollupCard: React.FC<{ row: MaterialRollupRow; names: OrderNames; expanded: boolean; onToggle: () => void }> = ({ row, names, expanded, onToggle }) => {
  const { t } = useTranslation('ownerMaterial');
  const sections = useSectionStages(expanded ? row.workOrderId : undefined);
  const label = names.label;
  return (
    <li className="px-[var(--panel-inset)] py-4" data-testid={`omr-row-${row.workOrderId}`}>
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex min-h-11 w-full items-start gap-2 text-left focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={expanded ? t('rollup.collapse', 'Hide locations of {{wo}}', { wo: label }) : t('rollup.expand', 'Locations of {{wo}}', { wo: label })}>
        <Icon name="chev" aria-hidden className={`mt-1 size-3.5 shrink-0 ${expanded ? 'rotate-90' : ''}`} />
        <span className="min-w-0">
          <Identity row={row} names={names} />
          <span className="block text-control text-muted-foreground">{t('rollup.sections', 'Locations')} {row.sectionCount}</span>
          <Unplaced n={row.unallocatedMovementCount} />
        </span>
      </button>
      <StageList s={row} step={row.reconciliationStep ? `${row.reconciliationStep} · ${pct(row.reconciliationPct)}` : '—'} testPrefix="omr-" />
      {expanded && (
        <div className="mt-3 border-l border-border pl-4">
          {sections.isPending && <ListState variant="loading" rows={2} />}
          {sections.isError && <ListState variant="error" title={t('rollup.locationsError', "Couldn't load the locations")} onRetry={() => void sections.refetch()} />}
          {sections.data?.length === 0 && <p className="text-control text-muted-foreground">{t('rollup.noLocations', 'No locations yet.')}</p>}
          {sections.data?.map((s) => (
            <div key={s.sectionId} className="py-3" data-testid={`omr-location-${s.sectionId}`}>
              <p className="text-foreground">{locationLabel(s.code, s.name)}</p>
              <Link to={`/work-orders/${row.workOrderId}?section=${s.sectionId}#wo-material`} className="inline-flex min-h-11 items-center text-control text-primary-text hover:underline">{t('rollup.openStages', 'Open stages')}</Link>
              <StageList s={s} step={s.step ? `${s.step} · ${pct(s.stepPct)}` : t('notStarted', 'Not started')} testPrefix="omr-loc-" />
            </div>
          ))}
        </div>
      )}
    </li>
  );
};
