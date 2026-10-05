import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { repositories } from '@/src/lib/repositories';
import type { IntegrationBinding } from '@/src/lib/repositories/types';
import {
  DEFAULT_MUTATION_TIMEOUT_MS,
  withTimeout,
} from '@/src/lib/withTimeout';
import {
  Button,
  Combobox,
  type ComboboxOption,
  EntityFormModal,
} from '@/src/components/ui';
import { useEntityForm } from '@/src/components/ui/useEntityForm';

export function ProjectErpLink({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const may = usePermission();
  const qc = useQueryClient();
  const queryKey = ['integrations', 'project-erp', orgId, projectId] as const;
  const binding = useQuery({
    queryKey,
    queryFn: () =>
      withTimeout(
        repositories.integrations.getBinding(orgId!, 'erpnext'),
        DEFAULT_MUTATION_TIMEOUT_MS,
      ),
    enabled: Boolean(orgId),
    retry: false,
  });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ComboboxOption | null>(null);
  const form = useEntityForm({
    initialValues: { erpProject: '' },
    requiredFields: ['erpProject'],
    idPrefix: 'project-erp',
  });
  const loadOptions = useCallback(
    async () =>
      (await repositories.integrations.listErpProjects('')).map((project) => ({
        value: project.name,
        label: `${project.project_name} (${project.name})`,
      })),
    [],
  );
  const mapped = binding.data?.config.project_map;
  const projectMap =
    mapped && typeof mapped === 'object' && !Array.isArray(mapped)
      ? mapped as Record<string, unknown>
      : {};
  const erpProject = projectMap[projectId];
  const canonicalName = typeof erpProject === 'string' && erpProject.trim()
    ? erpProject
    : null;
  let erpHref: string | null = null;
  if (canonicalName && binding.data?.site_url) {
    try {
      const url = new URL(binding.data.site_url);
      if (url.protocol === 'https:') {
        erpHref = `${url.origin}/app/project/${
          encodeURIComponent(canonicalName)
        }`;
      }
    } catch {
      /* An unavailable external destination must not become a navigation target. */
    }
  }
  const updateLink = (name: string) => {
    qc.setQueryData<IntegrationBinding | null>(
      queryKey,
      (previous) =>
        previous
          ? {
            ...previous,
            config: {
              ...previous.config,
              project_map: { ...projectMap, [projectId]: name },
            },
          }
          : previous,
    );
    void qc.invalidateQueries({
      queryKey: ['integrations', 'bindings', orgId],
    });
    void qc.invalidateQueries({ queryKey: ['integrations', 'setup', orgId] });
  };
  const ensure = async () => {
    setBusy(true);
    setError(null);
    try {
      updateLink(
        (await repositories.integrations.ensureErpProject(projectId))
          .erpProject,
      );
    } catch {
      setError(
        t(
          'projectDetail.erpLink.pending',
          'Project is saved in PMO. ERP linking did not complete; try linking again.',
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    await form.handleSubmit(async (values) => {
      setBusy(true);
      try {
        updateLink(
          (await repositories.integrations.linkErpProject(
            projectId,
            values.erpProject,
          )).erpProject,
        );
        setEditing(false);
      } catch {
        setError(
          t(
            'projectDetail.erpLink.failed',
            'Could not save the ERP project link. Check the selection and try again.',
          ),
        );
      } finally {
        setBusy(false);
      }
    });
  };
  const open = () => {
    form.reset({ erpProject: '' });
    setSelected(null);
    setError(null);
    setEditing(true);
  };
  if (!orgId) return null;
  if (binding.isPending) {
    return (
      <p role='status' className='text-sm text-muted-foreground'>
        {t('projectDetail.erpLink.loading', 'Loading ERP link…')}
      </p>
    );
  }
  if (binding.isError) {
    return (
      <div className='space-y-2'>
        <p role='status' className='text-sm text-muted-foreground'>
          {t('projectDetail.erpLink.unavailable', 'ERP link unavailable')}
        </p>
        <Button
          variant='outline'
          size='sm'
          onClick={() => void binding.refetch()}
        >
          {t('projectDetail.erpLink.retry', 'Retry')}
        </Button>
      </div>
    );
  }
  if (binding.data?.status !== 'active' || !binding.data.config.company) {
    return null;
  }
  return (
    <section
      aria-label={t('projectDetail.erpLink.title', 'ERPNext Project')}
      className='space-y-3'
    >
      <h3 className='text-sm font-semibold text-foreground'>
        {t('projectDetail.erpLink.title', 'ERPNext Project')}
      </h3>
      {canonicalName
        ? (erpHref
          ? (
            <a
              className='block break-words text-sm font-medium text-foreground underline underline-offset-4'
              href={erpHref}
              target='_blank'
              rel='noopener noreferrer'
            >
              {canonicalName}
            </a>
          )
          : <p className='break-words text-sm'>{canonicalName}</p>)
        : (
          <p className='text-sm text-muted-foreground'>
            {t(
              'projectDetail.erpLink.missing',
              'This project has no ERP link yet.',
            )}
          </p>
        )}
      <div className='flex flex-wrap gap-2'>
        {!canonicalName && may('transition', 'project') && (
          <Button
            variant='outline'
            size='sm'
            loading={busy}
            onClick={() => void ensure()}
          >
            {t('projectDetail.erpLink.link', 'Link ERP project')}
          </Button>
        )}
        {may('manage', 'integration') && (
          <Button variant='outline' size='sm' disabled={busy} onClick={open}>
            {t('projectDetail.erpLink.change', 'Change ERP project')}
          </Button>
        )}
      </div>
      {error && !editing && (
        <p role='status' className='text-sm text-muted-foreground'>{error}</p>
      )}
      {editing && (
        <EntityFormModal
          open
          title={t('projectDetail.erpLink.change', 'Change ERP project')}
          submitLabel={t('projectDetail.erpLink.save', 'Save project link')}
          onSubmit={save}
          onClose={() => setEditing(false)}
          loading={busy}
          dirty={form.isDirty}
          submitDisabled={!form.isComplete}
          submitError={error ? { headline: error } : null}
        >
          <p className='mb-4 text-sm text-muted-foreground'>
            {t(
              'projectDetail.erpLink.help',
              'Choose an active ERPNext Project for the connected Company. Its returned identifier will be saved as this project’s link.',
            )}
          </p>
          <Combobox
            label={t('projectDetail.erpLink.title', 'ERPNext Project')}
            value={form.values.erpProject || null}
            selectedOption={selected}
            onChange={(value, option) => {
              form.setValue('erpProject', value);
              setSelected(option);
            }}
            loadOptions={loadOptions}
            required
            noun={t('projectDetail.erpLink.noun', 'ERP project')}
          />
        </EntityFormModal>
      )}
    </section>
  );
}
