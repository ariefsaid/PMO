import type { TFunction } from 'i18next';
import { SelectField } from '@/src/components/ui';
import { trackFilterApplied } from '@/src/lib/analytics';
import type { useProjectListModel } from './useProjectListModel';

export function ProjectFilterFields({ model, t, mobile }: { model: ReturnType<typeof useProjectListModel>; t: TFunction; mobile: boolean }) {
  const { filterClient, filterEndCustomer, filterPM, customerFilterOptions, endCustomerFilterOptions,
    pmFilterOptions, clientCompaniesResult, companiesResult, projectManagersResult, setWorkingSet } = model;
  const fields = [
    { key: 'client' as const, label: t('projects.filters.customerLabel', 'Filter by customer'), value: filterClient,
      options: customerFilterOptions, result: clientCompaniesResult, analytics: 'customer' },
    { key: 'endClient' as const, label: t('projects.filters.endCustomerLabel', 'Filter by end customer'), value: filterEndCustomer,
      options: endCustomerFilterOptions, result: companiesResult, analytics: 'end_customer' },
    { key: 'pm' as const, label: t('projects.filters.pmLabel', 'Filter by project manager'), value: filterPM,
      options: pmFilterOptions, result: projectManagersResult, analytics: 'project_manager' },
  ];
  return <div className={mobile ? 'w-full min-w-0 space-y-3' : 'flex min-w-0 flex-wrap gap-2'}>
    {fields.map((field) => <div key={field.key} className={mobile ? 'w-full min-w-0 space-y-1' : 'min-w-0 space-y-1'}>
      <SelectField label={field.label} hideLabel={!mobile} value={field.value} options={field.options}
        fullWidth={mobile} className={mobile ? undefined : 'w-auto'} onChange={(value) => {
          setWorkingSet((ws) => ({ ...ws, [field.key]: value }));
          trackFilterApplied(field.analytics, field.options.length, 'projects');
        }} />
      {!field.result.isPending && field.result.isError && <div className="flex items-center gap-2">
        <p role="alert" className="text-[12px] text-destructive">{t('projects.mobile.error', "Couldn't load options")}</p>
        <button type="button" onClick={() => void field.result.refetch()} className="text-[12px] font-semibold text-primary underline-offset-2 hover:underline">
          {t('projects.mobile.retry', 'Retry')}
        </button>
      </div>}
    </div>)}
  </div>;
}
