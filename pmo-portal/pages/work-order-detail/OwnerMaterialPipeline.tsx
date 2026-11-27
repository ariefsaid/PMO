import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button, ListState, RecordSection, SelectField, TextField } from '@/src/components/ui';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import { PaginationFooter } from '@/src/components/ui/PaginationFooter';
import { parsePageParam, useClampPage } from '@/src/components/ui/usePageParam';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useMaterialConfig, useMaterialLines, useSectionStages, useSetReconciliation } from '@/src/hooks/useOwnerMaterial';
import { MATERIAL_PAGE_SIZE, type MaterialLine } from '@/src/lib/repositories/ownerMaterial';
import { formatDay } from '@/src/lib/format';
import { categoryLabel, isDenied, locationLabel, pct, qty } from '@/src/lib/ownerMaterialFormat';
import { useSubmitError } from './clientMaterialText';

// Stage columns share what the item column leaves: their headings wrap, so all eight read at 1440 without a sideways scroll.
const th = 'sticky top-0 z-10 bg-card px-3 py-2 align-bottom text-control font-normal text-muted-foreground';
const td = 'px-3 py-2 align-top';

interface Props { workOrderId: string }

/**
 * Owner-supplied material stages of one work order (#3010): pick a location (section), read what was requested,
 * set aside by the owner, received, issued, returned, moved and left, with the server's percentages; a Material
 * Coordinator records the location's reconciliation step. Quantities per unit are never totalled across units;
 * the table is paged on the server and the page and location live in the address.
 */
export const OwnerMaterialPipeline: React.FC<Props> = ({ workOrderId }) => {
  const { t } = useTranslation('ownerMaterial');
  const submitError = useSubmitError();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const viewOnly = realRole !== effectiveRole;
  const [params, setParams] = useSearchParams();
  const sections = useSectionStages(workOrderId);
  const live = sections.data ?? [];
  const requested = params.get('section');
  const sectionId = live.find((s) => s.sectionId === requested)?.sectionId ?? live[0]?.sectionId ?? null;
  const page = parsePageParam(params.get('mpage') ?? '');
  const setPage = (next: number, options?: { replace: boolean }) => setParams((c) => { const n = new URLSearchParams(c); if (next > 1) n.set('mpage', String(next)); else n.delete('mpage'); return n; }, options);
  const lines = useMaterialLines(workOrderId, sectionId, page);
  useClampPage(page, lines.data?.total, MATERIAL_PAGE_SIZE, setPage);
  const config = useMaterialConfig();

  const title = t('title', 'Material stages');
  if (sections.isPending) return <RecordSection title={title}><ListState variant="loading" rows={4} /></RecordSection>;
  if (sections.isError) return <RecordSection title={title}><ListState variant="error" title={t('error', "Couldn't load the material stages")} onRetry={() => void sections.refetch()} /></RecordSection>;
  if (!sectionId) return null; // a work order with no location has no owner material to show

  const selectLocation = (id: string) => setParams((c) => { const n = new URLSearchParams(c); n.set('section', id); n.delete('mpage'); return n; });
  const section = live.find((s) => s.sectionId === sectionId)!;
  const costCode = section.ownerCostCode;
  const canRecord = may('recordReconciliation', 'ownerMaterial', { record: { viewOnly } });

  const head = (
    <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-end gap-x-6 gap-y-2">
        <div className="w-full sm:w-64">
          <SelectField label={t('location', 'Location')} value={sectionId} onChange={selectLocation} data-testid="om-location"
            options={live.map((s) => ({ value: s.sectionId, label: locationLabel(s.code, s.name) }))} />
        </div>
        {costCode && <p className="flex min-h-[var(--control-height)] items-center text-control text-muted-foreground" data-testid="om-cost-code">{t('costCode', 'Owner cost code {{code}}', { code: costCode })}</p>}
      </div>
      <Reconciliation key={sectionId} sectionId={sectionId} steps={config.data?.steps ?? []} currentId={section.stepId}
        stepLabel={section.step ? `${section.step} · ${pct(section.stepPct)}` : t('notStarted', 'Not started')}
        canRecord={canRecord && Boolean(config.data)} submitError={submitError} />
    </div>
  );

  let body: React.ReactNode;
  if (lines.isPending) body = <ListState variant="loading" rows={5} />;
  else if (lines.isError && isDenied(lines.error)) body = <p role="alert" className="text-control text-muted-foreground" data-testid="om-denied">{t('denied', "You can't view the material stages of this location.")}</p>;
  else if (lines.isError) body = <ListState variant="error" title={t('error', "Couldn't load the material stages")} onRetry={() => void lines.refetch()} />;
  else if (lines.data.rows.length === 0 && lines.data.total === 0) body = <p className="text-control text-muted-foreground" data-testid="om-empty">{t('empty', 'No material is planned for this location.')}</p>;
  else body = <LinesTable rows={lines.data.rows} categories={config.data?.categories ?? []} asOf={lines.data.rows.find((r) => r.asOf)?.asOf ?? null} />;

  return (
    <RecordSection title={title} data-testid="owner-material-pipeline" flush={Boolean(lines.data?.rows.length)}
      bodyClassName={lines.data?.rows.length ? 'pb-0' : undefined}>
      <div className={lines.data?.rows.length ? 'px-[var(--panel-inset)]' : undefined}>{head}</div>
      <Skipped count={section.skippedSourceRows} codes={section.skippedReasonCodes} />
      {body}
      {lines.data && lines.data.total > 0 && <PaginationFooter pagination={{ page, pageSize: MATERIAL_PAGE_SIZE, onPageChange: (p) => setPage(p) }} total={lines.data.total} shown={lines.data.rows.length} />}
    </RecordSection>
  );
};

interface StageCell { key: string; label: string; q: string; p?: string | null; moved?: { in: string; out: string }; note?: string; over?: boolean }

/** A flag from the server's own quantities for this one line (never a recomputed percentage): more arrived at this stage than was planned. */
const isOver = (q: string, planned: string): boolean => Number(planned) > 0 && Number(q) > Number(planned);

const stageCells = (l: MaterialLine, t: TFunction): StageCell[] => [
  { key: 'planned', label: t('col.planned', 'Planned'), q: l.planned },
  { key: 'requested', label: t('col.requested', 'Requested'), q: l.requested, p: l.requestedPct, over: isOver(l.requested, l.planned) },
  { key: 'set-aside', label: t('col.setAside', 'Owner set-aside'), q: l.setAside, p: l.setAsidePct, over: isOver(l.setAside, l.planned) },
  { key: 'received', label: t('col.received', 'Received'), q: l.received, p: l.receivedPct, over: isOver(l.received, l.planned) },
  { key: 'issued', label: t('col.issued', 'Issued'), q: l.issued, p: l.issuedPct, over: isOver(l.issued, l.planned) },
  { key: 'returned', label: t('col.returned', 'Returned'), q: l.returned, note: Number(l.ownerReturn) !== 0 ? t('returnedToOwner', 'returned to owner {{n}}', { n: qty(l.ownerReturn) }) : undefined },
  { key: 'transferred', label: t('col.transferred', 'Transferred'), q: '', moved: { in: l.transferIn, out: l.transferOut } },
  { key: 'closing', label: t('col.closing', 'Closing stock'), q: l.closing, p: l.closingPct },
];

const Over: React.FC = () => {
  const { t } = useTranslation('ownerMaterial');
  return <span className="ml-1 text-control font-medium text-warning-text" data-testid="om-over">{t('overPlan', 'over plan')}</span>;
};

/** Contract v2.4: a location loaded with source rows skipped says so above its table; reasons in plain words, from the server's codes. */
const Skipped: React.FC<{ count: number; codes: string[] }> = ({ count, codes }) => {
  const { t } = useTranslation('ownerMaterial');
  if (count <= 0) return null;
  const why = codes.map((c) => t(`skipReason.${c}`, { defaultValue: c.replace(/_/g, ' ') })).join(', ');
  return (
    <p className="px-[var(--panel-inset)] pb-3 text-control text-foreground" data-testid="om-skipped">
      {t('skipped', { count, defaultValue_one: '{{count}} source row was not loaded', defaultValue_other: '{{count}} source rows were not loaded' })}
      {why && <span className="text-muted-foreground" data-testid="om-skipped-why"> · {why}</span>}
    </p>
  );
};

/** A transfer shows 0 when nothing moved, and in / out only when something did. */
const Moved: React.FC<{ moved: { in: string; out: string }; t: TFunction; stacked: boolean }> = ({ moved, t, stacked }) => {
  if (Number(moved.in) === 0 && Number(moved.out) === 0) return <>{qty('0')}</>;
  const a = t('transferIn', 'in {{n}}', { n: qty(moved.in) });
  const b = t('transferOut', 'out {{n}}', { n: qty(moved.out) });
  return stacked ? <><div>{a}</div><div className="text-control text-muted-foreground">{b}</div></> : <>{a} · {b}</>;
};

/** The source's own words for one line (verbatim strings, never computed on): `key: value`, nested values flattened. */
const evidenceText = (v: unknown): string => (Array.isArray(v) ? v.map(evidenceText).join(', ') : v && typeof v === 'object'
  ? Object.entries(v).map(([k, x]) => `${k.replace(/_/g, ' ')} ${evidenceText(x)}`).join(', ') : String(v ?? ''));

const Evidence: React.FC<{ line: MaterialLine }> = ({ line }) => {
  const { t } = useTranslation('ownerMaterial');
  if (!line.evidence || Object.keys(line.evidence).length === 0) return null;
  return (
    <details className="mt-1 max-w-xs" data-testid="om-evidence">
      <summary className="cursor-pointer text-control text-primary-text">{t('evidence', 'Source evidence')}</summary>
      <dl className="mt-1 text-control">
        {Object.entries(line.evidence).map(([k, v]) => (
          <div key={k} className="mb-1"><dt className="text-muted-foreground">{k.replace(/_/g, ' ')}</dt><dd className="break-words text-foreground">{evidenceText(v)}</dd></div>
        ))}
      </dl>
    </details>
  );
};

const ItemName: React.FC<{ l: MaterialLine; categories: readonly { code: string; name: string }[] }> = ({ l, categories }) => (
  <>
    <div className="font-medium text-foreground">{l.itemName}</div>
    <div className="text-control text-muted-foreground">{[l.itemCode, l.unit, categoryLabel(l.categoryCode, categories)].filter(Boolean).join(' · ')}</div>
    <Evidence line={l} />
  </>
);

const LinesTable: React.FC<{ rows: MaterialLine[]; categories: readonly { code: string; name: string }[]; asOf: string | null }> = ({ rows, categories, asOf }) => {
  const { t } = useTranslation('ownerMaterial');
  const wide = useIsDesktop();
  const heads = rows.length ? stageCells(rows[0], t) : [];
  return (
    <>
      {asOf && <p className="border-t border-border/70 px-[var(--panel-inset)] py-3 text-control text-muted-foreground" data-testid="om-as-of">{t('asOf', 'Loaded position as of {{date}}', { date: formatDay(asOf) })}</p>}
      {wide ? (
        <div className="max-h-[calc(100vh-10rem)] overflow-auto border-t border-border/70" tabIndex={0} role="region" aria-label={t('tableLabel', 'Material stages by item')}>
          <table className="w-full min-w-[960px] border-collapse text-left" data-testid="om-table">
            <thead>
              <tr className="border-b border-border/70">
                <th scope="col" className={`${th} left-0 z-20 w-56 px-[var(--table-cell-inset)]`}>{t('col.item', 'Item')}</th>
                {heads.map((c) => <th key={c.key} scope="col" className={`${th} text-right`}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {rows.map((l) => (
                <tr key={l.planId} data-testid={`om-row-${l.planId}`}>
                  <th scope="row" className={`${td} sticky left-0 w-56 bg-card px-[var(--table-cell-inset)] text-left font-normal`}><ItemName l={l} categories={categories} /></th>
                  {stageCells(l, t).map((c) => (
                    <td key={c.key} className={`${td} text-right tabular-nums`} data-testid={`om-${c.key}`}>
                      {c.moved ? <Moved moved={c.moved} t={t} stacked /> : <div>{qty(c.q)}</div>}
                      {c.note && <div className="text-control text-muted-foreground" data-testid={`om-${c.key}-note`}>{c.note}</div>}
                      {c.p !== undefined && <div className="text-control text-muted-foreground">{pct(c.p)}{c.over && <Over />}</div>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="divide-y divide-border/70 border-t border-border/70" data-testid="om-cards" aria-label={t('tableLabel', 'Material stages by item')}>
          {rows.map((l) => (
            <li key={l.planId} className="px-[var(--panel-inset)] py-4" data-testid={`om-row-${l.planId}`}>
              <ItemName l={l} categories={categories} />
              <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_3.5rem] gap-x-3 gap-y-2 text-control">
                {stageCells(l, t).map((c) => (
                  <React.Fragment key={c.key}>
                    <dt className="text-muted-foreground">{c.label}{c.note && <span className="block" data-testid={`om-${c.key}-note`}>{c.note}</span>}</dt>
                    {/* quantity and percentage keep their own columns, so every figure of the list ends on one edge */}
                    <dd className="contents" data-testid={`om-${c.key}`}>
                      <span className="text-right tabular-nums">{c.moved ? <Moved moved={c.moved} t={t} stacked={false} /> : qty(c.q)}</span>
                      <span className="text-right tabular-nums text-muted-foreground">{c.p !== undefined ? pct(c.p) : ''}{c.over && <Over />}</span>
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

interface RecProps {
  sectionId: string; steps: { id: string; name: string; position: number; percentage: string }[]; currentId: string | null;
  stepLabel: string; canRecord: boolean; submitError: ReturnType<typeof useSubmitError>;
}

/** The location's reconciliation step: read for everyone, recorded by the Material Coordinator; moving back needs a reason. */
const Reconciliation: React.FC<RecProps> = ({ sectionId, steps, currentId, stepLabel, canRecord, submitError }) => {
  const { t } = useTranslation('ownerMaterial');
  const save = useSetReconciliation();
  const [stepId, setStepId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setStepId(currentId ?? ''); }, [currentId]);
  const from = steps.find((s) => s.id === currentId)?.position ?? 0;
  const to = steps.find((s) => s.id === stepId)?.position ?? 0;
  const backwards = Boolean(currentId) && to < from;
  const changed = stepId !== '' && stepId !== currentId;
  const needsReason = backwards && reason.trim() === '';
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="om-reconciliation">
      <p className="text-control text-muted-foreground">
        {t('reconciliation', 'Material reconciliation')}: <span className="font-medium text-foreground" data-testid="om-step">{stepLabel}</span>
      </p>
      {canRecord && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
          e.preventDefault(); setError(null);
          save.mutateAsync({ sectionId, stepId, reason: reason.trim() || null }).then(() => setReason('')).catch((err: unknown) => setError(submitError(err).headline));
        }}>
          <div className="w-44">
            <SelectField label={t('step', 'Step')} hideLabel value={stepId} onChange={setStepId} placeholder={t('chooseStep', 'Choose a step')}
              options={steps.map((s) => ({ value: s.id, label: `${s.name} · ${pct(s.percentage)}` }))} data-testid="om-step-select" />
          </div>
          {backwards && <div className="w-56"><TextField label={t('reason', 'Reason')} hideLabel value={reason} onChange={setReason} placeholder={t('reasonWhy', 'Why it moves back')} /></div>}
          <Button type="submit" size="sm" variant="primary" loading={save.isPending} disabled={!changed || needsReason}>{t('record', 'Record step')}</Button>
        </form>
      )}
      {error && <p role="alert" className="text-control text-destructive" data-testid="om-save-error">{error}</p>}
    </div>
  );
};
