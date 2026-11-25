import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, FieldError, ListState, SelectField, TextField, useToast } from '@/src/components/ui';
import { useJobRoleOptions } from '@/src/hooks/useJobRoleOptions';
import { parseTargetDays } from '@/src/lib/checklistDue';
import { usePermission } from '@/src/auth/usePermission';
import { useSaveWorkOrderCheckTemplate, useWorkOrderCheckTemplate } from '@/src/hooks/useWorkOrderCheckTemplate';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

/**
 * Administration › Projects › Standard checks for a new work order (#2898): the checks the organisation wants done before
 * a work order is issued. Each line names a job role and a number of days, never a person. When a work order is captured
 * as a Draft its tasks appear, due that many days later and owned by the one person holding the job role (otherwise the
 * issuer gives them an owner). Nothing is supplied by the system: the list starts empty. A saved change reaches only Drafts
 * captured afterwards. Admin-only via `can('manage', 'workOrderCheckTemplate')` (UX); the RPC decides.
 */
interface Row { key: string; id: string | null; label: string; ownerJobRole: string; days: string }
const MAX_ITEMS = 50;
let nextKey = 0;
const fresh = (): Row => ({ key: `new-${nextKey++}`, id: null, label: '', ownerJobRole: '', days: '' });

const WorkOrderCheckTemplate: React.FC = () => {
  const { t } = useTranslation('administration');
  const { toast } = useToast();
  const may = usePermission();
  const query = useWorkOrderCheckTemplate();
  const save = useSaveWorkOrderCheckTemplate();
  const roleOptions = useJobRoleOptions(t('admin.checkTemplate.chooseRole', 'Choose a job role'), ['manager', 'officer']);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (query.data && rows === null) setRows(query.data.map((i) => ({ key: i.id, id: i.id, label: i.label, ownerJobRole: i.owner_job_role ?? '', days: i.target_days === null ? '' : String(i.target_days) })));
  }, [query.data, rows]);

  if (!may('manage', 'workOrderCheckTemplate')) return null;

  const live = rows ?? [];
  const dirty = JSON.stringify(live.map((r) => [r.id, r.label.trim(), r.ownerJobRole, r.days.trim()]))
    !== JSON.stringify((query.data ?? []).map((i) => [i.id, i.label, i.owner_job_role ?? '', i.target_days === null ? '' : String(i.target_days)]));
  // A line is complete with a check, a job role and 1 to 365 days (the save function refuses anything less).
  const incomplete = live.some((r) => !r.label.trim() || !r.ownerJobRole || typeof parseTargetDays(r.days) !== 'number');
  const patch = (key: string, p: Partial<Row>) => setRows(live.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...live];
    const [row] = next.splice(index, 1);
    next.splice(index + by, 0, row);
    setRows(next);
  };

  const onSave = async () => {
    setError(undefined);
    try {
      await save.mutateAsync(live.map((r) => ({ id: r.id, label: r.label, ownerJobRole: r.ownerJobRole, targetDays: parseTargetDays(r.days) as number })));
      setRows(null);
      toast(t('admin.checkTemplate.saved', 'Standard checks saved'), undefined, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setError(detail || headline);
    }
  };

  return (
    <section id="work-order-checks" tabIndex={-1} className="scroll-mt-4" aria-labelledby="work-order-checks-heading">
      <h2 id="work-order-checks-heading" className="text-group font-semibold tracking-[-0.01em]">{t('admin.checkTemplate.title', 'Standard checks for a new work order')}</h2>
      <p className="mt-1 max-w-prose text-control text-muted-foreground">
        {t('admin.checkTemplate.helper', 'When a work order is captured as a draft, each line becomes a task, due that many days later. The person holding the job role owns it; if several or nobody hold it, the issuer chooses.')}
      </p>
      <div className="mt-4 max-w-5xl space-y-3">
        {error && <FieldError id="work-order-checks-error">{error}</FieldError>}
        {query.isError && !query.data ? (
          <ListState variant="error" title={t('admin.checkTemplate.loadError', "Couldn't load the standard checks")} onRetry={() => void query.refetch()} />
        ) : rows === null ? (
          <ListState variant="loading" rows={2} />
        ) : (
          <>
            {live.length === 0 && <p className="text-control text-muted-foreground">{t('admin.checkTemplate.empty', 'No standard checks. New work orders start with none.')}</p>}
            <ol className="space-y-2">
              {live.map((r, i) => (
                <li key={r.key} className="flex flex-wrap items-end gap-2 lg:flex-nowrap">
                  <span className="w-6 shrink-0 pb-2 text-control text-muted-foreground" aria-hidden="true">{i + 1}.</span>
                  <TextField wrapperClassName="min-w-0 flex-1 basis-[calc(100%-2rem)] lg:basis-0" label={t('admin.checkTemplate.itemLabel', 'Check {{n}}', { n: i + 1 })} hideLabel value={r.label} maxLength={200}
                    onChange={(v) => patch(r.key, { label: v })} />
                  <SelectField wrapperClassName="min-w-0 basis-[calc(100%-2rem)] max-lg:ml-8 lg:w-52 lg:basis-auto" label={t('admin.checkTemplate.roleFor', 'Job role for check {{n}}', { n: i + 1 })} hideLabel
                    value={r.ownerJobRole} options={roleOptions} onChange={(v) => patch(r.key, { ownerJobRole: v })} />
                  <TextField wrapperClassName="w-24 max-lg:ml-8" label={t('admin.checkTemplate.daysFor', 'Days for check {{n}}', { n: i + 1 })} hideLabel inputMode="numeric"
                    placeholder={t('admin.checkTemplate.daysPlaceholder', 'Days')} value={r.days} onChange={(v) => patch(r.key, { days: v })} />
                  <span className="pb-2 text-control text-muted-foreground" aria-hidden="true">{t('admin.checkTemplate.daysUnit', 'days')}</span>
                  <span className="flex gap-1">
                    <Button variant="outline" size="sm" disabled={i === 0} aria-label={t('admin.checkTemplate.up', 'Move {{name}} up', { name: r.label || i + 1 })} onClick={() => move(i, -1)}>↑</Button>
                    <Button variant="outline" size="sm" disabled={i === live.length - 1} aria-label={t('admin.checkTemplate.down', 'Move {{name}} down', { name: r.label || i + 1 })} onClick={() => move(i, 1)}>↓</Button>
                    <Button variant="outline" size="sm" aria-label={t('admin.checkTemplate.remove', 'Remove {{name}}', { name: r.label || i + 1 })} onClick={() => setRows(live.filter((x) => x.key !== r.key))}>{t('admin.checkTemplate.removeShort', 'Remove')}</Button>
                  </span>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" disabled={live.length >= MAX_ITEMS} onClick={() => setRows([...live, fresh()])}>{t('admin.checkTemplate.add', 'Add a check')}</Button>
              <Button variant="primary" disabled={!dirty || incomplete || save.isPending} onClick={() => void onSave()}>{t('admin.checkTemplate.save', 'Save checks')}</Button>
              {dirty && <Button variant="ghost" onClick={() => setRows(null)}>{t('admin.checkTemplate.discard', 'Discard changes')}</Button>}
            </div>
          </>
        )}
      </div>
    </section>
  );
};
export default WorkOrderCheckTemplate;
