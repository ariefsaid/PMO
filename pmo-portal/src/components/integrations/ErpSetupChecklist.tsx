import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { repositories } from '@/src/lib/repositories';
import { Constants } from '@/src/lib/supabase/database.types';
import {
  Button,
  ConfirmDialog,
  EntityFormModal,
  FormGrid,
  ListState,
  SelectField,
  TextField,
} from '@/src/components/ui';
import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { domainLabel } from './integrationLabels';

const ERP_DOMAINS = ['companies', 'procurement', 'revenue', 'timesheets'];
const COMPANY_DEFAULTS = [
  'company',
  'default_payable_account',
  'default_expense_account',
  'default_cash_account',
  'default_bank_account',
  'cost_center',
];

export function ErpSetupChecklist(
  { orgId, onRefreshCompany }: {
    orgId: string | undefined;
    onRefreshCompany: () => void;
  },
) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const setup = useQuery({
    queryKey: ['integrations', 'setup', orgId],
    queryFn: () => repositories.integrations.getErpSetup(),
    enabled: Boolean(orgId),
    retry: false,
  });
  const [editing, setEditing] = useState<'defaults' | 'domain' | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onboardError, setOnboardError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const defaults = useEntityForm({
    initialValues: { activityType: '', receivableAccount: '' },
    requiredFields: ['activityType', 'receivableAccount'],
    idPrefix: 'erp-defaults',
  });
  const domain = useEntityForm({
    initialValues: { domain: '' },
    requiredFields: ['domain'],
    idPrefix: 'erp-domain',
  });
  const refresh = async () => {
    await setup.refetch();
    void qc.invalidateQueries({
      queryKey: ['external-domain-ownership', orgId],
    });
    void qc.invalidateQueries({
      queryKey: ['integrations', 'bindings', orgId],
    });
    void qc.invalidateQueries({ queryKey: ['integrations', 'health', orgId] });
  };
  const openDefaults = () => {
    defaults.reset({
      activityType: setup.data?.defaults.default_activity_type ?? '',
      receivableAccount: setup.data?.defaults.default_receivable_account ?? '',
    });
    setError(null);
    setEditing('defaults');
  };
  const openDomains = () => {
    domain.reset({
      domain: ERP_DOMAINS.find((value) =>
        !setup.data?.domains.includes(value)
      ) ?? ERP_DOMAINS[0],
    });
    setError(null);
    setEditing('domain');
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const form = editing === 'defaults' ? defaults : domain;
    await form.handleSubmit(async () => {
      setBusy(true);
      try {
        if (editing === 'defaults') {
          await repositories.integrations.saveErpDefaults({
            activityType: defaults.values.activityType.trim(),
            receivableAccount: defaults.values.receivableAccount.trim(),
          });
        } else {await repositories.integrations.employErpDomain(
            domain.values.domain,
          );}
        setEditing(null);
        await refresh();
      } catch {
        setError(
          editing === 'defaults'
            ? t(
              'integrations.erpSetup.defaultsFailed',
              'Could not save ERP defaults. Check the values and try again.',
            )
            : t(
              'integrations.erpSetup.domainFailed',
              'Could not employ this domain. Check ERP read permissions and try again.',
            ),
        );
      } finally {
        setBusy(false);
      }
    });
  };
  const onboard = async () => {
    setBusy(true);
    setOnboardError(null);
    try {
      await repositories.integrations.onboardErpParties();
      setOnboarding(false);
      setNotice(
        t(
          'integrations.erpSetup.onboarded',
          'ERP parties are onboarded. Review the Companies list.',
        ),
      );
      await refresh();
    } catch {
      setOnboardError(
        t(
          'integrations.erpSetup.onboardFailed',
          'Party onboarding did not complete. Try again.',
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const domainNames: Record<string, string> = {
    companies: t('integrations.erpSetup.domainNames.companies', 'Companies'),
    procurement: t('integrations.erpSetup.domainNames.procurement', 'Procurement'),
    revenue: t('integrations.erpSetup.domainNames.revenue', 'Revenue'),
    timesheets: t('integrations.erpSetup.domainNames.timesheets', 'Timesheets'),
  };
  const domainText = (value: string) => domainNames[value] ?? domainLabel(value);
  const actionLink =
    'text-sm font-medium text-foreground underline underline-offset-4 break-words';
  return (
    <section
      aria-labelledby='erp-setup-heading'
      className='mt-5 border-t border-border pt-4'
    >
      <h4
        id='erp-setup-heading'
        className='text-sm font-semibold text-foreground'
      >
        {t('integrations.erpSetup.title', 'ERPNext setup')}
      </h4>
      <p className='mb-3 mt-1 text-sm text-muted-foreground'>
        {t(
          'integrations.erpSetup.description',
          'A connection is ready for work when its required setup is complete.',
        )}
      </p>
      {setup.isPending
        ? <ListState variant='loading' rows={4} />
        : setup.isError
        ? (
          <ListState
            variant='error'
            title={t(
              'integrations.erpSetup.unavailable',
              'ERP setup unavailable',
            )}
            sub={t(
              'integrations.erpSetup.unavailableHelp',
              'The checklist could not be read. Try again.',
            )}
            onRetry={() => void setup.refetch()}
          />
        )
        : setup.data && (
          <>
            <ul className='divide-y divide-border text-sm'>
              <li className='grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
                <div className='min-w-0'>
                  <p className='font-medium'>
                    {t('integrations.erpSetup.domains', 'Domains employed')}
                  </p>
                  <p className='mt-1 text-muted-foreground break-words'>
                    {setup.data.domains.length
                      ? setup.data.domains.map((value) =>
                        domainText(value)
                      ).join(', ')
                      : t(
                        'integrations.erpSetup.noDomains',
                        'No ERP domains employed',
                      )}
                  </p>
                </div>
                <Button variant='outline' size='sm' onClick={openDomains}>
                  {t('integrations.erpSetup.employ', 'Employ ERP domains')}
                </Button>
              </li>
              <li className='grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
                <div>
                  <p className='font-medium'>
                    {t(
                      'integrations.erpSetup.companyDefaults',
                      'Company defaults',
                    )}
                  </p>
                  <p className='mt-1 text-muted-foreground tabular-nums'>
                    {t(
                      'integrations.erpSetup.configured',
                      '{{count}} of {{total}} configured',
                      {
                        count: COMPANY_DEFAULTS.filter((key) =>
                          setup.data?.defaults[key]
                        ).length,
                        total: COMPANY_DEFAULTS.length,
                      },
                    )}
                  </p>
                </div>
                <Button variant='outline' size='sm' onClick={onRefreshCompany}>
                  {t(
                    'integrations.erpSetup.refreshCompany',
                    'Refresh Company defaults',
                  )}
                </Button>
              </li>
              <li className='grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
                <div className='min-w-0'>
                  <p className='font-medium'>
                    {t(
                      'integrations.erpSetup.activityReceivable',
                      'Activity and receivable defaults',
                    )}
                  </p>
                  <p className='mt-1 break-words text-muted-foreground'>
                    {setup.data.defaults.default_activity_type ??
                      t(
                        'integrations.erpSetup.activityMissing',
                        'Activity type not set',
                      )} · {setup.data.defaults.default_receivable_account ??
                      t(
                        'integrations.erpSetup.receivableMissing',
                        'Receivable account not set',
                      )}
                  </p>
                </div>
                <Button variant='outline' size='sm' onClick={openDefaults}>
                  {t(
                    'integrations.erpSetup.setDefaults',
                    'Set activity and receivable defaults',
                  )}
                </Button>
              </li>
              <li className='grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
                <div>
                  <p className='font-medium'>
                    {t('integrations.erpSetup.budgetMap', 'Budget account map')}
                  </p>
                  <p className='mt-1 text-muted-foreground tabular-nums'>
                    {t(
                      'integrations.erpSetup.configured',
                      '{{count}} of {{total}} configured',
                      {
                        count: setup.data.budgetMappedCategories.length,
                        total: Constants.public.Enums.budget_category.length,
                      },
                    )}
                  </p>
                </div>
                <a
                  className={actionLink}
                  href='/administration/accounting#budget-account-map'
                >
                  {t('integrations.erpSetup.mapBudget', 'Map budget accounts')}
                </a>
              </li>
              <li className='grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
                <div>
                  <p className='font-medium'>
                    {t('integrations.erpSetup.employeeLinks', 'Employee links')}
                  </p>
                  <p className='mt-1 text-muted-foreground tabular-nums'>
                    {t(
                      'integrations.erpSetup.employeesMissing',
                      '{{count}} active members need a confirmed ERP employee link',
                      { count: setup.data.unlinkedEmployeeCount },
                    )}
                  </p>
                </div>
                <a className={actionLink} href='/approvals'>
                  {t(
                    'integrations.erpSetup.reviewEmployees',
                    'Review employee links',
                  )}
                </a>
              </li>
              <li className='py-3'>
                <p className='font-medium'>
                  {t('integrations.erpSetup.projects', 'Unmapped projects')}
                </p>
                {setup.data.unmappedProjects.length
                  ? (
                    <ul className='mt-2 space-y-2'>
                      {setup.data.unmappedProjects.map((project) => (
                        <li key={project.id}>
                          <a
                            className={actionLink}
                            href={`/projects/${project.id}`}
                          >
                            {t(
                              'integrations.erpSetup.linkProject',
                              'Link {{name}}',
                              { name: project.name },
                            )}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )
                  : (
                    <p className='mt-1 text-muted-foreground'>
                      {t(
                        'integrations.erpSetup.projectsLinked',
                        'All active PMO projects have an ERP link.',
                      )}
                    </p>
                  )}
              </li>
            </ul>
            <div className='mt-3 flex flex-wrap items-center gap-3'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => {
                  setOnboarding(true);
                  setOnboardError(null);
                }}
              >
                {t('integrations.erpSetup.onboard', 'Onboard ERP parties')}
              </Button>
              <a className={actionLink} href='/companies'>
                {t('integrations.erpSetup.reviewParties', 'Review companies')}
              </a>
              <Button
                variant='ghost'
                size='sm'
                loading={setup.isFetching}
                onClick={() =>
                  void setup.refetch()}
              >
                {t('integrations.erpSetup.refresh', 'Refresh checklist')}
              </Button>
            </div>
          </>
        )}
      {notice && (
        <p role='status' className='mt-3 text-sm text-muted-foreground'>
          {notice}
        </p>
      )}
      {editing && (
        <EntityFormModal
          open
          title={editing === 'defaults'
            ? t('integrations.erpSetup.defaultsTitle', 'ERPNext defaults')
            : t('integrations.erpSetup.domainTitle', 'Employ ERP domain')}
          submitLabel={editing === 'defaults'
            ? t('integrations.erpSetup.saveDefaults', 'Save defaults')
            : t('integrations.erpSetup.employDomain', 'Employ domain')}
          onSubmit={save}
          onClose={() => setEditing(null)}
          loading={busy}
          dirty={editing === 'defaults' ? defaults.isDirty : domain.isDirty}
          submitDisabled={editing === 'defaults'
            ? !defaults.isComplete
            : !domain.isComplete}
          submitError={error ? { headline: error } : null}
        >
          {editing === 'defaults'
            ? (
              <FormGrid>
                <TextField
                  {...defaults.fieldProps('activityType')}
                  label={t(
                    'integrations.erpSetup.activityType',
                    'Activity type',
                  )}
                  required
                  fullWidth
                  helper={t(
                    'integrations.erpSetup.activityHelp',
                    'Enter the name of an enabled Activity Type in ERPNext.',
                  )}
                />
                <TextField
                  {...defaults.fieldProps('receivableAccount')}
                  label={t(
                    'integrations.erpSetup.receivableAccount',
                    'Receivable account',
                  )}
                  required
                  fullWidth
                  helper={t(
                    'integrations.erpSetup.receivableHelp',
                    'Enter an enabled receivable account for the connected Company.',
                  )}
                />
              </FormGrid>
            )
            : (
              <>
                <p className='mb-3 text-sm text-muted-foreground'>
                  {t(
                    'integrations.erpSetup.domainHelp',
                    'ERPNext will own this domain. Check that its existing records and integration permissions are ready before continuing.',
                  )}
                </p>
                <SelectField
                  {...domain.fieldProps('domain')}
                  label={t('integrations.erpSetup.domainLabel', 'Domain')}
                  options={ERP_DOMAINS.map((value) => ({
                    value,
                    label: domainText(value),
                  }))}
                  required
                />
              </>
            )}
        </EntityFormModal>
      )}
      <ConfirmDialog
        open={onboarding}
        title={t('integrations.erpSetup.onboardTitle', 'Onboard ERP parties?')}
        description={onboardError ??
          t(
            'integrations.erpSetup.onboardHelp',
            'Import Supplier and Customer links from the connected ERPNext instance. Existing resolved links are reused.',
          )}
        confirmLabel={t(
          'integrations.erpSetup.startOnboard',
          'Start onboarding',
        )}
        loading={busy}
        onConfirm={() => void onboard()}
        onCancel={() => setOnboarding(false)}
      />
    </section>
  );
}
