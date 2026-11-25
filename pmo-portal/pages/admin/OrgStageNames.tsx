import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, FieldError, ListState, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { saveStageName, validateStageName } from '@/src/lib/db/stageNames';
import { ORG_STAGE_NAMES_KEY, useOrgStageNames } from '@/src/hooks/useOrgStageNames';
import { projectStatusGroup, type ProjectStatus, type ProjectStatusGroup } from '@/src/lib/db/projectTransitions';
import { STATUS_MAP, shippedStatusLabel } from '@/src/lib/status/statusMap';
import type { StageNameRow } from '@/src/lib/status/orgStageNames';

/**
 * Administration › Project setup › Sales and project stages (#2906 slice 1). An Admin names each stage in
 * English and Bahasa; a blank name keeps the shipped wording. Names only change what people read: stored
 * stages, filters, saved views and reports keep their keys. UX gate only: the Admin-only row policy decides.
 */
const GROUPS: ProjectStatusGroup[] = ['pipeline', 'onHand', 'lost', 'internal'];
const english = (_k: string, d: string) => d;
const STAGE_ORDER = Object.keys(STATUS_MAP.project);
const COLS = 'md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_minmax(0,1fr)]';
type Draft = { en: string; id: string };
type Lang = 'en' | 'id';

/** The names a stage's draft would show, per language, for the duplicate check across the whole list. */
function shownName(row: StageNameRow, draft: Draft, lang: Lang): string {
  return (draft[lang].trim() || (lang === 'en' ? shippedStatusLabel('project', row.status, english) : '')).toLowerCase();
}

const StageNamesCard: React.FC = () => {
  const { t, i18n } = useTranslation('administration');
  const { t: tStatus } = useTranslation('status');
  const { toast } = useToast();
  const qc = useQueryClient();
  const query = useOrgStageNames();
  const groupTitle: Record<ProjectStatusGroup, string> = {
    pipeline: t('admin.stageNames.group.pipeline', 'Pipeline'),
    onHand: t('admin.stageNames.group.onHand', 'On hand'),
    lost: t('admin.stageNames.group.lost', 'Lost'),
    internal: t('admin.stageNames.group.internal', 'Internal'),
  };
  const rows = useMemo(
    () => [...(query.data ?? [])].sort((a, b) => STAGE_ORDER.indexOf(a.status) - STAGE_ORDER.indexOf(b.status)),
    [query.data],
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // The shipped Bahasa wording for the placeholders: the Bahasa catalogue may not be loaded for an English reader yet.
  const [, bump] = useState(0);
  useEffect(() => { void Promise.resolve(i18n.loadLanguages?.('id')).then(() => bump((n) => n + 1)); }, [i18n]);
  const idT = i18n.getFixedT?.('id', 'status');
  const saved = (r: StageNameRow): Draft => ({ en: r.label_en ?? '', id: r.label_id ?? '' });
  const draftOf = (r: StageNameRow): Draft => drafts[r.status] ?? saved(r);
  const dirty = rows.filter((r) => {
    const d = draftOf(r), s = saved(r);
    return d.en.trim() !== s.en || d.id.trim() !== s.id;
  });

  const save = async () => {
    const found: Record<string, string> = {};
    for (const r of dirty) {
      const d = draftOf(r);
      const bad = (['en', 'id'] as const).map((lang) => {
        const others = rows.filter((o) => o.status !== r.status).map((o) => shownName(o, draftOf(o), lang)).filter(Boolean);
        return validateStageName(d[lang], others);
      }).find(Boolean);
      if (bad) found[r.status] = bad === 'tooLong' ? t('admin.stageNames.tooLong', 'Use 40 characters or fewer') : t('admin.stageNames.duplicate', 'Another stage already has this name');
    }
    setErrors(found);
    if (Object.keys(found).length) return; // nothing is written until every name is acceptable
    setSaving(true);
    const results = await Promise.allSettled(dirty.map((r) => saveStageName(r.status, draftOf(r))));
    const failed: Record<string, string> = {};
    results.forEach((res, i) => {
      if (res.status === 'rejected') {
        const { headline, detail } = classifyMutationError(res.reason);
        failed[dirty[i].status] = detail || headline;
      }
    });
    setErrors(failed);
    setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([status]) => status in failed)));
    setSaving(false);
    if (results.some((res) => res.status === 'fulfilled')) {
      await qc.invalidateQueries({ queryKey: [...ORG_STAGE_NAMES_KEY] });
      if (!Object.keys(failed).length) toast(t('admin.stageNames.saved', 'Stage names saved'), undefined, 'success');
    }
  };

  const setField = (status: string, row: StageNameRow, lang: Lang, value: string) =>
    setDrafts((d) => ({ ...d, [status]: { ...(d[status] ?? saved(row)), [lang]: value } }));

  return (
    <section id="stage-names" tabIndex={-1} className="scroll-mt-4" aria-labelledby="stage-names-heading">
      <h2 id="stage-names-heading" className="text-group font-semibold tracking-[-0.01em]">{t('admin.stageNames.title', 'Sales and project stages')}</h2>
      <p className="mt-1 max-w-prose text-control text-muted-foreground">{t('admin.stageNames.helper', 'Rename a stage to match your own process. A blank name keeps the shipped name. Records, filters and reports keep working.')}</p>
      {query.isError && !query.data ? (
        <ListState variant="error" title={t('admin.stageNames.loadError', "Couldn't load the stages")} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <ListState variant="loading" rows={3} />
      ) : (
        <>
          <div aria-hidden="true" className={`mt-4 hidden gap-3 border-b border-border pb-2 text-control text-muted-foreground md:grid ${COLS}`}>
            <span>{t('admin.stageNames.stage', 'Stage')}</span>
            <span>{t('admin.stageNames.english', 'English')}</span>
            <span>{t('admin.stageNames.bahasa', 'Bahasa Indonesia')}</span>
          </div>
          {GROUPS.map((g) => (
            <div key={g} className="mt-4">
              <h3 className="text-control font-semibold text-foreground">{groupTitle[g]}</h3>
              <ul className="divide-y divide-border">
                {rows.filter((r) => projectStatusGroup(r.status as ProjectStatus) === g).map((r) => {
                  const shipped = shippedStatusLabel('project', r.status, tStatus);
                  const d = draftOf(r);
                  const err = errors[r.status];
                  return (
                    <li key={r.status} data-testid={`stage-name-row-${r.status}`} className={`grid gap-2 py-2 md:items-center md:gap-3 ${COLS}`}>
                      <span className="text-control text-foreground">{shipped}</span>
                      <span className="flex items-center gap-2">
                        <span aria-hidden="true" className="w-6 shrink-0 text-control text-muted-foreground md:hidden">EN</span>
                        <TextField hideLabel fullWidth wrapperClassName="flex-1" label={t('admin.stageNames.inputEn', '{{stage}}, English name', { stage: shipped })}
                          placeholder={shippedStatusLabel('project', r.status, english)} aria-invalid={Boolean(err) || undefined}
                          value={d.en} onChange={(v) => setField(r.status, r, 'en', v)} />
                      </span>
                      <span className="flex items-center gap-2">
                        <span aria-hidden="true" className="w-6 shrink-0 text-control text-muted-foreground md:hidden">ID</span>
                        <TextField hideLabel fullWidth wrapperClassName="flex-1" label={t('admin.stageNames.inputId', '{{stage}}, Bahasa Indonesia name', { stage: shipped })}
                          placeholder={shippedStatusLabel('project', r.status, idT ?? english)} aria-invalid={Boolean(err) || undefined}
                          value={d.id} onChange={(v) => setField(r.status, r, 'id', v)} />
                      </span>
                      {err && <div className="md:col-span-3" data-testid={`stage-name-error-${r.status}`}><FieldError id={`stage-name-error-${r.status}`}>{err}</FieldError></div>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <div className="mt-4 flex justify-end">
            <Button variant="primary" disabled={saving || dirty.length === 0} onClick={() => void save()}>{t('admin.stageNames.save', 'Save')}</Button>
          </div>
        </>
      )}
    </section>
  );
};

const OrgStageNames: React.FC = () => (usePermission()('manage', 'orgStageNames') ? <StageNamesCard /> : null);
export default OrgStageNames;
