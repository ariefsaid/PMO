import { LinkExistingRecordFolders } from '@/src/components/m365/LinkExistingRecordFolders';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, ConfirmDialog, EntityFormModal, FormGrid, Icon, ListState, SelectField, useEntityForm, type SubmitError } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { listDrives, listSites } from '@/src/lib/m365/graphClient';
import { useDocumentLinkPermissions } from '@/src/components/m365/DocumentLinkPermissions';
import { useMicrosoftDocuments, useSetDefaultLibrary } from '@/src/hooks/useMicrosoftDocuments';

export interface M365DefaultLibraryCardProps {
  /** Stable mount slot beside the Admin actions, e.g. a "Link existing folders" button. */
  children?: React.ReactNode;
}

/**
 * Org default document library (AC-M365DOC-055/056/060). A singleton, Admin-managed starting point for
 * the Microsoft picker; it is display data only — it never grants item access and says nothing about
 * anyone's connection. Choosing browses through the Admin's OWN connection (GET-only); clearing is a
 * plain database write and needs no connection at all. A failed read is shown as unavailable, never as
 * "None", and the setting is never changed by a member's Microsoft denial. Impersonation is view-only.
 */
export const M365DefaultLibraryCard: React.FC<M365DefaultLibraryCardProps> = ({ children }) => {
  const { t } = useTranslation();
  const permissions = useDocumentLinkPermissions();
  const { connection, defaultLibrary, isPending, defaultError, refetch } = useMicrosoftDocuments();
  const setDefault = useSetDefaultLibrary();
  const [chooseOpen, setChooseOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearError, setClearError] = useState<SubmitError | null>(null);

  // Arriving by the "Choose the default document library" link: bring this card into view.
  useEffect(() => {
    if (window.location.hash === '#m365-default-library') document.getElementById('m365-default-library')?.scrollIntoView?.({ block: 'start' });
  }, []);

  const canManage = permissions.manageDefault() && setDefault !== null;
  const connected = connection?.connected === true && connection.status === 'active';
  const readFailed = defaultError != null;

  async function confirmClear() {
    if (!setDefault) return;
    setClearError(null);
    try {
      await setDefault.mutateAsync(null);
      setClearOpen(false);
    } catch (error) {
      setClearError({
        headline: t('m365Documents.defaultLibrary.clearFailed', 'Could not clear the default library.'),
        detail: classifyMutationError(error, undefined, { module: 'unknown', operation: 'update' }).detail,
      });
    }
  }

  return (
    <Card id="m365-default-library" className="mb-3.5 scroll-mt-4 p-4" data-testid="m365-default-library">
      <div className="flex items-center gap-2">
        <Icon name="folder" aria-hidden="true" />
        <h3 className="text-[15px] font-semibold text-foreground">
          {t('m365Documents.defaultLibrary.heading', 'Default document library')}
        </h3>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('m365Documents.defaultLibrary.description', 'The library the document picker opens in first. It does not give anyone access to its files; Microsoft permissions still apply.')}
      </p>

      <div className="mt-3 min-w-0">
        {isPending ? (
          <ListState variant="loading" rows={1} />
        ) : readFailed ? (
          <ListState
            variant="error"
            title={t('m365Documents.defaultLibrary.unavailable', 'The default library could not be read')}
            sub={t('m365Documents.defaultLibrary.unavailableSub', 'The current setting is unchanged. Try again.')}
            onRetry={() => void refetch()}
          />
        ) : defaultLibrary ? (
          <p className="break-words text-[13px] text-foreground" data-testid="m365-default-library-current">
            <span className="text-muted-foreground">{t('m365Documents.defaultLibrary.current', 'Current default:')} </span>
            {`${defaultLibrary.site_name} / ${defaultLibrary.drive_name}`}
          </p>
        ) : (
          <p className="text-[13px] text-muted-foreground">{t('m365Documents.defaultLibrary.none', 'No default library is set.')}</p>
        )}
      </div>

      {canManage && (
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={!connected} onClick={() => setChooseOpen(true)}>
            {t('m365Documents.defaultLibrary.choose', 'Choose default library')}
          </Button>
          {defaultLibrary && !readFailed && (
            <Button variant="ghost" size="sm" onClick={() => { setClearError(null); setClearOpen(true); }}>
              {t('m365Documents.defaultLibrary.clear', 'Clear default')}
            </Button>
          )}
          <LinkExistingRecordFolders defaultAvailable={Boolean(defaultLibrary) && !readFailed} />
          {children}
        </div>
      )}
      {canManage && !connected && !isPending && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          {t('m365Documents.defaultLibrary.connectHint', 'Connect your Microsoft 365 account to choose a library. Clearing the default does not need a connection.')}
        </p>
      )}

      {chooseOpen && <ChooseLibraryModal onClose={() => setChooseOpen(false)} />}
      <ConfirmDialog
        open={clearOpen}
        tone="destructive"
        title={t('m365Documents.defaultLibrary.clearTitle', 'Clear the default library?')}
        description={
          <>
            {t('m365Documents.defaultLibrary.clearDescription', 'The document picker will start from the location chooser. Existing links are not changed.')}
            {clearError && (
              <span role="alert" className="mt-2 block rounded-md border border-destructive/30 bg-destructive/[0.07] p-2 text-[12px] text-destructive-text">
                <strong className="block">{clearError.headline}</strong>
                {clearError.detail}
              </span>
            )}
          </>
        }
        confirmLabel={t('m365Documents.defaultLibrary.clear', 'Clear default')}
        loading={setDefault?.isPending ?? false}
        onConfirm={() => void confirmClear()}
        onCancel={() => { setClearOpen(false); setClearError(null); }}
      />
    </Card>
  );
};

function ChooseLibraryModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id ?? null;
  const userId = currentUser?.id ?? null;
  const setDefault = useSetDefaultLibrary();
  const form = useEntityForm<{ site: string; drive: string }>({ initialValues: { site: '', drive: '' }, requiredFields: ['site', 'drive'] });
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [saving, setSaving] = useState(false);

  const sites = useQuery({
    queryKey: ['m365-default-sites', orgId, userId],
    queryFn: async () => (await listSites()).value,
    retry: false,
  });
  const siteId = form.values.site;
  const drives = useQuery({
    queryKey: ['m365-default-drives', orgId, userId, siteId],
    queryFn: async () => (await listDrives(siteId)).value,
    enabled: siteId !== '',
    retry: false,
  });

  const site = sites.data?.find((s) => s.id === siteId) ?? null;
  const drive = drives.data?.find((d) => d.id === form.values.drive) ?? null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!site || !drive || !setDefault || saving) return;
    setSaving(true); setSubmitError(null);
    try {
      await setDefault.mutateAsync({ site_id: site.id, site_name: site.name, drive_id: drive.id, drive_name: drive.name });
      onClose();
    } catch (error) {
      setSubmitError({
        headline: t('m365Documents.defaultLibrary.saveFailed', 'Could not save the default library.'),
        detail: classifyMutationError(error, undefined, { module: 'unknown', operation: 'update' }).detail,
      });
    } finally {
      setSaving(false);
    }
  }

  const loadError = sites.isError || drives.isError;
  return (
    <EntityFormModal
      open
      title={t('m365Documents.defaultLibrary.modalTitle', 'Choose default library')}
      subtitle={t('m365Documents.defaultLibrary.modalSub', 'Pick a SharePoint site, then one of its document libraries.')}
      submitLabel={t('m365Documents.defaultLibrary.save', 'Save default')}
      disabledReason={t('m365Documents.defaultLibrary.disabledReason', 'Choose a site and a library to save.')}
      onSubmit={(e) => void submit(e)}
      onClose={onClose}
      submitDisabled={!form.isComplete || !site || !drive}
      loading={saving}
      submitError={submitError}
    >
      <FormGrid>
        <SelectField
          label={t('m365Documents.defaultLibrary.site', 'Site')}
          required
          fullWidth
          value={form.values.site}
          onChange={(value) => form.setValues({ site: value, drive: '' })}
          options={(sites.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          placeholder={sites.isPending ? t('m365Documents.defaultLibrary.loading', 'Loading…') : t('m365Documents.defaultLibrary.pickSite', 'Select a site')}
          disabled={sites.isPending}
        />
        <SelectField
          label={t('m365Documents.defaultLibrary.library', 'Library')}
          required
          fullWidth
          value={form.values.drive}
          onChange={(value) => form.setValue('drive', value)}
          options={(drives.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
          placeholder={drives.isFetching ? t('m365Documents.defaultLibrary.loading', 'Loading…') : t('m365Documents.defaultLibrary.pickLibrary', 'Select a library')}
          disabled={siteId === '' || drives.isFetching}
        />
      </FormGrid>
      {loadError && (
        <p role="status" className="mt-2 text-[12px] text-destructive-text">
          {t('m365Documents.defaultLibrary.browseFailed', 'Microsoft locations could not be loaded. Close this dialog and try again.')}
        </p>
      )}
    </EntityFormModal>
  );
}
