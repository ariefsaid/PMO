import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, ListState, TextField, useToast } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { resetOrgTerm, saveOrgTerm, validateOverride } from '@/src/lib/db/orgTerminology';
import { ORG_TERMINOLOGY_KEY, useOrgTerminology } from '@/src/hooks/useOrgTerminology';
import { shippedTerm, TERM_KEYS, TERM_LOCALES, type TermForms, type TermKey, type TermLocale } from '@/src/lib/i18n/orgTerms';

/**
 * Administration › Terminology (#2529). The Admin renames the fixed set of PMO terms, in English
 * and Bahasa Indonesia, singular and plural. Saving re-renders every screen through the i18next
 * `orgTerms` post-processor. RLS is the write authority; the shell already limits this page to
 * Admin (ADR-0016).
 *
 * The "shipped" column is built from the registry, NOT from `t()`, so a rename never rewrites the
 * label that tells the Admin what is being renamed.
 */

const LOCALE_NAME: Record<TermLocale, string> = { en: 'English', id: 'Bahasa Indonesia' };

const TermRow: React.FC<{ termKey: TermKey; locale: TermLocale; current?: TermForms }> = ({ termKey, locale, current }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const shipped = shippedTerm(locale, termKey);
  const [singular, setSingular] = useState(current?.singular ?? '');
  const [plural, setPlural] = useState(current?.plural ?? '');
  useEffect(() => {
    setSingular(current?.singular ?? '');
    setPlural(current?.plural ?? '');
  }, [current?.singular, current?.plural]);

  const refresh = () => qc.invalidateQueries({ queryKey: ORG_TERMINOLOGY_KEY });
  const save = useMutation({
    mutationFn: () => saveOrgTerm({ key: termKey, locale, singular, plural: plural || singular }),
    onSuccess: () => {
      toast(t('administration:terminology.saved', 'Terminology saved'), 'success');
      return refresh();
    },
    onError: (e) => toast(classifyMutationError(e).headline, 'error'),
  });
  const reset = useMutation({
    mutationFn: () => resetOrgTerm(termKey, locale),
    onSuccess: () => {
      toast(t('administration:terminology.resetDone', 'Back to the default wording'), 'success');
      return refresh();
    },
    onError: (e) => toast(classifyMutationError(e).headline, 'error'),
  });

  const invalid = singular.trim() !== '' && validateOverride({ key: termKey, locale, singular, plural: plural || singular }) !== null;
  const dirty = singular !== (current?.singular ?? '') || plural !== (current?.plural ?? '');
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr_1fr_auto] sm:items-end" data-testid={`term-row-${termKey}-${locale}`}>
      <div className="text-sm text-text-secondary">
        {t('administration:terminology.default', 'Default')}: {shipped.singular} / {shipped.plural}
      </div>
      <TextField
        label={t('administration:terminology.singular', 'Singular')}
        value={singular}
        placeholder={shipped.singular}
        maxLength={60}
        onChange={setSingular}
        fullWidth
      />
      <TextField
        label={t('administration:terminology.plural', 'Plural')}
        value={plural}
        placeholder={shipped.plural}
        maxLength={60}
        onChange={setPlural}
        fullWidth
      />
      <div className="flex gap-2">
        <Button variant="primary" disabled={!dirty || singular.trim() === '' || invalid || save.isPending} onClick={() => save.mutate()}>
          {t('administration:terminology.save', 'Save')}
        </Button>
        <Button variant="outline" disabled={!current || reset.isPending} onClick={() => reset.mutate()}>
          {t('administration:terminology.reset', 'Reset')}
        </Button>
      </div>
    </div>
  );
};

const AdministrationTerminology: React.FC = () => {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useOrgTerminology();
  return (
    <div data-testid="administration-panel-terminology" className="min-w-0 space-y-4">
      <p className="text-sm text-text-secondary">
        {t('administration:terminology.intro', 'Rename these terms to match how your organisation talks. The new wording replaces the default everywhere it is shown, in each language.')}
      </p>
      {isLoading ? <ListState variant="loading" /> : null}
      {isError ? <ListState variant="error" onRetry={() => void refetch()} /> : null}
      {!isLoading && !isError ? (
        <>
        {TERM_KEYS.map((key) => (
          <Card key={key} className="space-y-4 p-4" data-testid={`term-card-${key}`}>
            <h3 className="text-base font-semibold">{shippedTerm('en', key).singular}</h3>
            {TERM_LOCALES.map((locale) => (
              <div key={locale} className="space-y-2">
                <div className="text-sm font-medium">{LOCALE_NAME[locale]}</div>
                <TermRow termKey={key} locale={locale} current={data?.[locale]?.[key]} />
              </div>
            ))}
          </Card>
        ))}
        </>
      ) : null}
    </div>
  );
};

export default AdministrationTerminology;
