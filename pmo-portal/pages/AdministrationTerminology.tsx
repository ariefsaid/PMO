import React, { useEffect, useState } from 'react';
import { usePermission } from '@/src/auth/usePermission';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, ListState, TextField, ViewToggle, useToast } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { resetOrgTerm, saveOrgTerm, validateOverride } from '@/src/lib/db/orgTerminology';
import { ORG_TERMINOLOGY_KEY, useOrgTerminology } from '@/src/hooks/useOrgTerminology';
import AdministrationRoleNames from './AdministrationRoleNames';
import { shippedTerm, TERM_KEYS, TERM_LOCALES, type TermForms, type TermKey, type TermLocale } from '@/src/lib/i18n/orgTerms';

/**
 * Administration › Terminology (#2529). The Admin renames the fixed set of PMO terms, in English
 * and Bahasa Indonesia, singular and plural. Saving re-renders every screen through the i18next
 * terminology plugin. RLS is the write authority; write controls follow the Admin permission
 * (ADR-0016), and read-only viewers can inspect the settings.
 *
 * The "shipped" column is built from the registry, NOT from `t()`, so a rename never rewrites the
 * label that tells the Admin what is being renamed.
 */

const LOCALE_NAME: Record<TermLocale, string> = { en: 'English', id: 'Bahasa Indonesia' };

type Draft = { singular: string; plural: string };
const draftOf = (current?: TermForms): Draft => ({ singular: current?.singular ?? '', plural: current?.plural ?? '' });
const isDirty = (draft: Draft, current?: TermForms) => draft.singular !== (current?.singular ?? '') || draft.plural !== (current?.plural ?? '');

/** One term, both languages, ONE save: the card saves whichever languages were changed (a blanked language goes back to its
 *  default wording) and Reset returns both. */
const TermCard: React.FC<{ termKey: TermKey; current?: Partial<Record<TermLocale, TermForms>> }> = ({ termKey, current }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const canEdit = usePermission()('edit', 'user');
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<TermLocale, Draft>>({ en: draftOf(current?.en), id: draftOf(current?.id) });
  useEffect(() => {
    setDrafts({ en: draftOf(current?.en), id: draftOf(current?.id) });
  }, [current?.en?.singular, current?.en?.plural, current?.id?.singular, current?.id?.plural]);
  const edit = (locale: TermLocale, field: keyof Draft, value: string) => setDrafts((d) => ({ ...d, [locale]: { ...d[locale], [field]: value } }));

  const refresh = () => qc.invalidateQueries({ queryKey: ORG_TERMINOLOGY_KEY });
  const save = useMutation({
    mutationFn: async () => {
      for (const locale of TERM_LOCALES) {
        const draft = drafts[locale];
        if (!isDirty(draft, current?.[locale])) continue;
        if (draft.singular.trim() === '') { if (current?.[locale]) await resetOrgTerm(termKey, locale); continue; }
        await saveOrgTerm({ key: termKey, locale, singular: draft.singular, plural: draft.plural || draft.singular });
      }
    },
    onSuccess: () => {
      toast(t('administration:terminology.saved', 'Terminology saved'), undefined, 'success');
      return refresh();
    },
    onError: (e) => toast(classifyMutationError(e).headline, undefined, 'error'),
  });
  const reset = useMutation({
    mutationFn: async () => { for (const locale of TERM_LOCALES) if (current?.[locale]) await resetOrgTerm(termKey, locale); },
    onSuccess: () => {
      toast(t('administration:terminology.resetDone', 'Back to the default wording'), undefined, 'success');
      return refresh();
    },
    onError: (e) => toast(classifyMutationError(e).headline, undefined, 'error'),
  });

  const dirty = TERM_LOCALES.some((l) => isDirty(drafts[l], current?.[l]));
  const invalid = TERM_LOCALES.some((l) => drafts[l].singular.trim() !== '' && validateOverride({ key: termKey, locale: l, singular: drafts[l].singular, plural: drafts[l].plural || drafts[l].singular }) !== null);
  const hasOverride = TERM_LOCALES.some((l) => Boolean(current?.[l]));
  return (
    <Card className="space-y-3 p-4" data-testid={`term-card-${termKey}`}>
      <h3 className="text-base font-semibold">{shippedTerm('en', termKey).singular}</h3>
      {TERM_LOCALES.map((locale) => {
        const shipped = shippedTerm(locale, termKey);
        return (
          <div key={locale} className="space-y-2" data-testid={`term-row-${termKey}-${locale}`}>
            <div className="text-sm font-medium">{LOCALE_NAME[locale]}</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr_1fr] sm:items-end">
              <div className="text-sm text-text-secondary">
                {t('administration:terminology.default', 'Default')}: {shipped.singular} / {shipped.plural}
              </div>
              <TextField label={t('administration:terminology.singular', 'Singular')} disabled={!canEdit} value={drafts[locale].singular}
                placeholder={shipped.singular} maxLength={60} onChange={(v) => edit(locale, 'singular', v)} fullWidth />
              <TextField label={t('administration:terminology.plural', 'Plural')} disabled={!canEdit} value={drafts[locale].plural}
                placeholder={shipped.plural} maxLength={60} onChange={(v) => edit(locale, 'plural', v)} fullWidth />
            </div>
          </div>
        );
      })}
      {canEdit && (
        <div className="flex gap-2">
          <Button variant="primary" disabled={!dirty || invalid || save.isPending} onClick={() => save.mutate()}>
            {t('administration:terminology.save', 'Save')}
          </Button>
          <Button variant="outline" disabled={!hasOverride || reset.isPending} onClick={() => reset.mutate()}>
            {t('administration:terminology.reset', 'Reset')}
          </Button>
        </div>
      )}
    </Card>
  );
};

type TerminologyView = 'terms' | 'roles';

const AdministrationTerminology: React.FC = () => {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useOrgTerminology();
  const [view, setView] = useState<TerminologyView>('terms');
  return (
    <div data-testid="administration-panel-terminology" className="min-w-0 space-y-4">
      <ViewToggle<TerminologyView> semantics="toggle" ariaLabel={t('administration:terminology.viewLabel', 'What to rename')} value={view} onChange={setView}
        options={[
          { value: 'terms', label: t('administration:terminology.viewTerms', 'Terms') },
          { value: 'roles', label: t('administration:terminology.viewRoles', 'Role names') },
        ]} />
      {view === 'roles' ? <AdministrationRoleNames /> : (
        <>
          <p className="text-sm text-text-secondary">
            {t('administration:terminology.intro', 'Rename these terms to match how your organisation talks. The new wording replaces the default everywhere it is shown, in each language, and is used exactly as you type it.')}
          </p>
          {isLoading ? <ListState variant="loading" /> : null}
          {isError ? <ListState variant="error" onRetry={() => void refetch()} /> : null}
          {!isLoading && !isError ? TERM_KEYS.map((key) => (
            <TermCard key={key} termKey={key} current={{ en: data?.en?.[key], id: data?.id?.[key] }} />
          )) : null}
        </>
      )}
    </div>
  );
};

export default AdministrationTerminology;
