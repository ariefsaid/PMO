import type { ProjectClassificationOptions } from '@/src/lib/db/orgs';
import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, FormGrid, ListState, TextArea, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { parseClassificationOptions } from '@/src/lib/projectClassification';
import { useProjectClassificationOptions, PROJECT_CLASSIFICATION_OPTIONS_KEY } from '@/src/hooks/useProjectClassificationOptions';

export default function OrgProjectClassificationOptions() {
  const { t } = useTranslation();
  const may = usePermission();
  const { toast } = useToast();
  const qc = useQueryClient();
  const query = useProjectClassificationOptions();
  const [draft, setDraft] = useState<{ serviceLines: string; sectors: string }>();
  const mutation = useMutation({
    mutationFn: (value: ProjectClassificationOptions) => repositories.orgSettings.setProjectClassificationOptions(value),
    onSuccess: () => qc.invalidateQueries({ queryKey: [PROJECT_CLASSIFICATION_OPTIONS_KEY] }),
  });
  if (!query.data) return query.isError
    ? <ListState variant="error" title={t('projectClassification.loadError', "Couldn't load classification options")} retryLabel={t('admin.retry', 'Retry')} onRetry={() => void query.refetch()} />
    : <ListState variant="loading" rows={2} />;
  const values = draft ?? { serviceLines: query.data.serviceLines.join('\n'), sectors: query.data.sectors.join('\n') };
  const save = async () => {
    try {
      await mutation.mutateAsync({ serviceLines: parseClassificationOptions(values.serviceLines), sectors: parseClassificationOptions(values.sectors) });
      setDraft(undefined);
      toast(t('projectClassification.saved', 'Classification options saved'), t('projectClassification.retained', 'Existing project classifications stay recorded.'), 'success');
    } catch (error) {
      const { headline, detail } = classifyMutationError(error);
      toast(headline, detail, 'warning');
    }
  };
  return <section aria-label={t('projectClassification.title', 'Classification')} className="max-w-2xl space-y-4">
    <p className="text-sm text-muted-foreground">{t('projectClassification.setupHelp', 'Define the service lines and sectors available on project forms. Removing an option keeps it on existing projects.')}</p>
    {may('manage', 'orgProjectClassification') ? <>
      <FormGrid>
        <TextArea id="org-service-lines" label={t('projectClassification.serviceLines', 'Service lines')} value={values.serviceLines}
          onChange={(serviceLines) => setDraft({ ...values, serviceLines })} disabled={mutation.isPending} rows={6}
          helper={t('projectClassification.onePerLine', 'One option per line. Leave empty to offer no options.')} />
        <TextArea id="org-sectors" label={t('projectClassification.sectors', 'Sectors')} value={values.sectors}
          onChange={(sectors) => setDraft({ ...values, sectors })} disabled={mutation.isPending} rows={6}
          helper={t('projectClassification.onePerLine', 'One option per line. Leave empty to offer no options.')} />
      </FormGrid>
      <Button onClick={() => void save()} disabled={mutation.isPending}>{t('projectClassification.save', 'Save options')}</Button>
    </> : <>
      <dl className="space-y-4 text-sm">
        <div><dt className="text-muted-foreground">{t('projectClassification.serviceLines', 'Service lines')}</dt><dd className="break-words">{query.data.serviceLines.join(', ') || t('projectClassification.notSet', 'Not set')}</dd></div>
        <div><dt className="text-muted-foreground">{t('projectClassification.sectors', 'Sectors')}</dt><dd className="break-words">{query.data.sectors.join(', ') || t('projectClassification.notSet', 'Not set')}</dd></div>
      </dl>
      <p className="text-muted-foreground">{t('projectClassification.adminOnly', 'Only an Admin can change these options.')}</p>
    </>}
  </section>;
}
