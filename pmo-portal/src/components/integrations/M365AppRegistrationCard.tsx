import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button, Card, ConfirmDialog, FieldError, FormGrid, ListState, TextField } from '@/src/components/ui';
import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { usePermission } from '@/src/auth/usePermission';
import { useM365OrgApp } from '@/src/hooks/useM365OrgApp';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatRelativeTime } from '@/src/lib/format';
import { knownM365ErrorReason } from '@/src/lib/m365/errorCopy';
import type { M365OrgAppInfo, M365OrgAppInput } from '@/src/lib/m365/connectClient';

/**
 * M365AppRegistrationCard — step 1 of Microsoft 365 setup (#1017 S4, plan
 * docs/plans/2026-11-09-m365-self-serve-setup.md §2.4): the organisation's OWN Microsoft app
 * registration, entered by its Admin. Mounted above the organisation-approval card (app → approve →
 * connect).
 *
 * FE gate is Admin-only (`may('manage','integration')`, real role — ADR-0016, UX only): the edge fn
 * re-enforces Admin-of-org OR Operator. Everyone else sees a read-only note and nothing is fetched,
 * because the server would refuse the read.
 *
 * The client secret is WRITE-ONLY: the server returns only `secretSet`, the field always starts
 * empty, and the typed value lives only in the open form's state — the form unmounts after a save.
 * Errors render from the stable wire code (the shared M365 copy table), never the server message.
 *
 * Closed by default (#2260 owner ruling): the standing card is one status line — usable or not, and
 * how old Microsoft's last check is (#2260) — plus one action. The field labels, the redirect URIs
 * and their help are the setup detail, so they sit behind that action's disclosure. The screen has a
 * word ceiling; an always-open card spent it on help nobody reads twice.
 */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AppFormValues {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

function failureReason(t: TFunction, error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return knownM365ErrorReason(t, typeof code === 'string' ? code : undefined)
    ?? classifyMutationError(error, undefined, { module: 'unknown', operation: 'update' }).detail;
}

export const M365AppRegistrationCard: React.FC = () => {
  const { t } = useTranslation('administration');
  const may = usePermission();
  const canManage = may('manage', 'integration');
  const { query, save, clear } = useM365OrgApp(canManage);
  // The setup fields and their help sit behind a disclosure, closed by default: the standing card is
  // ONE status line and ONE action (#2260 owner ruling). The screen's word budget is a ceiling, so the
  // closed state carries no description and no field labels.
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const heading = (
    <h2 className="text-group font-semibold text-foreground">{t('integrations.m365App.heading', 'Microsoft 365 app')}</h2>
  );

  if (!canManage) {
    return (
      <Card className="mb-1 p-4" data-testid="m365-app-registration">
        {heading}
        <p className="mt-2.5 text-sm text-muted-foreground">{t('integrations.m365App.readOnly', 'Your administrator manages this app.')}</p>
      </Card>
    );
  }

  const info = query.data;
  const ownApp = info?.source === 'org';

  // One sentence an Admin can read at a glance: is the app usable, and how old the last check is
  // (a client secret expires). No separator glyph — the word budget counts whitespace tokens, and this
  // page's budget is a hard ceiling (owner ruling #2260): heading + status + action is the whole card.
  const readFailed = query.isError || !info;
  // A check inside the last day reads as "today": the relative formatter's own wording ("about 1 hour
  // ago") is the widest the status line gets, and the page's word ceiling is a hard one.
  const age = !info?.validatedAt
    ? null
    : Date.now() - Date.parse(info.validatedAt) < 86_400_000
      ? t('integrations.m365App.checkedToday', 'today')
      : formatRelativeTime(info.validatedAt);
  const status = readFailed
    ? t('integrations.m365App.statusUnreadable', 'Settings unavailable')
    : ownApp
      ? info.secretSet
        ? info.validatedAt
          ? t('integrations.m365App.statusConnected', 'Connected, {{age}}', { age })
          : t('integrations.m365App.statusNoCheck', 'Connected, check not recorded')
        : t('integrations.m365App.statusNoSecret', 'Not connected, secret missing')
      : info.source === 'deployment'
        ? t('integrations.m365App.statusPlatform', 'Connected, platform app')
        : t('integrations.m365App.statusNone', 'Not set up');

  async function confirmRemove() {
    setRemoveError(null);
    try {
      await clear.mutateAsync();
      setRemoveOpen(false);
      setEditing(false);
    } catch (error) {
      setRemoveError(`${t('integrations.m365App.removeFailed', "Couldn't remove the app registration.")} ${failureReason(t, error)}`);
    }
  }

  // ONE action, always in the same place: read failed -> retry; otherwise it opens the setup detail.
  const action = readFailed
    ? { label: t('integrations.m365App.retry', 'Try again'), onClick: () => void query.refetch(), detached: false }
    : {
        label: open
          ? t('integrations.m365App.hide', 'Hide')
          : ownApp
            ? t('integrations.m365App.manage', 'Manage')
            : t('integrations.m365App.setUp', 'Set up'),
        onClick: () => setOpen((was) => !was),
        detached: true,
      };
  const toggle = (
    <Button variant="outline" size="sm" onClick={action.onClick}
      aria-expanded={action.detached ? open : undefined}
      aria-controls={action.detached ? 'm365-app-details' : undefined}
      data-testid="m365-app-toggle">
      {action.label}
    </Button>
  );

  return (
    <Card className="mb-1 p-4" data-testid="m365-app-registration">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {heading}
        {!query.isPending && toggle}
      </div>

      <div className="mt-2.5 min-w-0">
        {query.isPending ? (
          <div data-testid="m365-app-loading"><ListState variant="loading" rows={2} /></div>
        ) : (
          <>
            <p className="text-control text-muted-foreground" data-testid="m365-app-status">{status}</p>
            {readFailed && (
              // The reason stays available to assistive tech without costing the screen a line.
              <p className="sr-only" data-testid="m365-app-status-reason">{failureReason(t, query.error)}</p>
            )}

            {info && open && (
              <div id="m365-app-details" data-testid="m365-app-details">
                <p className="mt-3 text-sm text-muted-foreground">
                  {t('integrations.m365App.description', 'The app your organization registered in Microsoft Entra. Microsoft checks it before it is saved.')}
                </p>
                {/* Setup help from the approval card (#2260): the page may not gain words, so the guidance
                    an Admin needs once — the order of the three steps — lives here, one click away. */}
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('integrations.m365App.approvalHelp', 'Organization approval is only needed if Microsoft asks for it. Each person then connects their own account.')}
                </p>

                {ownApp ? (
                  <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-control sm:grid-cols-[max-content_1fr]">
                    <dt className="text-muted-foreground">{t('integrations.m365App.tenantLabel', 'Directory (tenant) ID')}</dt>
                    <dd className="break-all font-mono text-foreground">{info.tenantId}</dd>
                    <dt className="text-muted-foreground">{t('integrations.m365App.clientLabel', 'Application (client) ID')}</dt>
                    <dd className="break-all font-mono text-foreground">{info.clientId}</dd>
                    <dt className="text-muted-foreground">{t('integrations.m365App.secretLabel', 'Client secret')}</dt>
                    <dd className="text-foreground">{info.secretSet ? t('integrations.m365App.secretSaved', 'Saved') : t('integrations.m365App.secretMissing', 'Not saved')}</dd>
                    <dt className="text-muted-foreground">{t('integrations.m365App.checkedLabel', 'Last checked')}</dt>
                    <dd className="text-foreground" data-testid="m365-app-checked">
                      {info.validatedAt
                        ? formatRelativeTime(info.validatedAt)
                        : t('integrations.m365App.checkedNever', 'Not recorded')}
                    </dd>
                  </dl>
                ) : (
                  <p className="mt-3 text-control text-muted-foreground">
                    {info.source === 'deployment'
                      ? t('integrations.m365App.usingPlatform', 'Your organization uses the platform-provided app.')
                      : t('integrations.m365App.none', 'No Microsoft app is set up yet.')}
                  </p>
                )}

                {ownApp && <CallbackUrls urls={info.callbackUrls} />}

                {editing ? (
                  <AppForm info={info} saving={save.isPending} onCancel={() => setEditing(false)} onSave={async (input) => {
                    await save.mutateAsync(input);
                    setEditing(false);
                  }} />
                ) : (
                  <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                      {ownApp ? t('integrations.m365App.edit', 'Edit app') : t('integrations.m365App.useOwn', 'Use our own app registration')}
                    </Button>
                    {ownApp && (
                      <Button variant="ghost" size="sm" onClick={() => { setRemoveError(null); setRemoveOpen(true); }}>
                        {t('integrations.m365App.remove', 'Remove our app registration')}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={removeOpen}
        tone="destructive"
        title={t('integrations.m365App.removeTitle', 'Remove the app registration?')}
        description={t('integrations.m365App.removeDescription', 'Everyone in your organization will need to reconnect Microsoft 365. The platform-provided app is used if one is available.')}
        confirmLabel={t('integrations.m365App.removeConfirm', 'Remove registration')}
        loading={clear.isPending}
        error={removeError}
        onConfirm={() => void confirmRemove()}
        onCancel={() => { setRemoveOpen(false); setRemoveError(null); }}
      />
    </Card>
  );
};

function CallbackUrls({ urls }: { urls: M365OrgAppInfo['callbackUrls'] }) {
  const { t } = useTranslation('administration');
  const rows = [
    { id: 'connect', url: urls.connect, label: t('integrations.m365App.connectUrl', 'Connection redirect URI'),
      help: t('integrations.m365App.connectUrlHelp', 'Add this as a redirect URI in your app registration.'),
      copy: t('integrations.m365App.copyConnect', 'Copy the connection redirect URI') },
    { id: 'signIn', url: urls.signIn, label: t('integrations.m365App.signInUrl', 'Sign-in redirect URI'),
      help: t('integrations.m365App.signInUrlHelp', 'Only if you use Microsoft sign-in.'),
      copy: t('integrations.m365App.copySignIn', 'Copy the sign-in redirect URI') },
  ];
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {rows.map(({ id, ...row }) => <CallbackUrlRow key={id} {...row} />)}
    </ul>
  );
}

function CallbackUrlRow({ url, label, help, copy }: { url: string; label: string; help: string; copy: string }) {
  const { t } = useTranslation('administration');
  const [copied, setCopied] = useState(false);
  return (
    <li className="min-w-0">
      <p className="text-control font-medium text-foreground">{label}</p>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <code className="min-w-0 break-all rounded-md bg-muted/40 px-2 py-0.5 font-mono text-control text-foreground">{url}</code>
        <Button variant="ghost" size="sm" aria-label={copy} onClick={() => {
          void navigator.clipboard?.writeText(url).then(() => setCopied(true), () => setCopied(false));
        }}>
          {copied ? t('integrations.m365App.copied', 'Copied') : t('integrations.m365App.copy', 'Copy')}
        </Button>
      </div>
      <p className="text-control text-muted-foreground">{help}</p>
    </li>
  );
}

function AppForm({ info, saving, onCancel, onSave }: {
  info: M365OrgAppInfo;
  saving: boolean;
  onCancel: () => void;
  onSave: (input: M365OrgAppInput) => Promise<void>;
}) {
  const { t } = useTranslation('administration');
  const ownApp = info.source === 'org';
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState<M365OrgAppInput | null>(null);
  const badId = t('integrations.m365App.idInvalid', "Paste the ID from the app's Overview page in Microsoft Entra.");
  const form = useEntityForm<AppFormValues>({
    // The secret ALWAYS starts empty: the server never returns it.
    initialValues: { tenantId: info.tenantId ?? '', clientId: info.clientId ?? '', clientSecret: '' },
    validate: (v) => {
      const errors: Partial<Record<keyof AppFormValues, string>> = {};
      if (!GUID.test(v.tenantId.trim())) errors.tenantId = badId;
      if (!GUID.test(v.clientId.trim())) errors.clientId = badId;
      if (!ownApp && !v.clientSecret.trim()) errors.clientSecret = t('integrations.m365App.secretRequired', 'Enter the client secret.');
      return errors;
    },
    idPrefix: 'm365-app',
    requiredFields: ownApp ? ['tenantId', 'clientId'] : ['tenantId', 'clientId', 'clientSecret'],
  });

  async function send(input: M365OrgAppInput) {
    setSubmitError(null);
    try {
      await onSave(input);
    } catch (error) {
      setPending(null);
      setSubmitError(`${t('integrations.m365App.saveFailed', "Couldn't save the app.")} ${failureReason(t, error)}`);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await form.handleSubmit(async (v) => {
      const input: M365OrgAppInput = { tenantId: v.tenantId.trim().toLowerCase(), clientId: v.clientId.trim().toLowerCase() };
      if (v.clientSecret.trim()) input.clientSecret = v.clientSecret.trim();
      const changesApp = ownApp && (input.tenantId !== info.tenantId?.toLowerCase() || input.clientId !== info.clientId?.toLowerCase());
      if (changesApp) setPending(input);
      else await send(input);
    });
  }

  return (
    <>
    <form className="mt-3 flex flex-col gap-3" data-testid="m365-app-form" onSubmit={(e) => void submit(e)} noValidate>
      <FormGrid>
        <TextField {...form.fieldProps('tenantId')} label={t('integrations.m365App.tenantLabel', 'Directory (tenant) ID')} required code autoComplete="off" />
        <TextField {...form.fieldProps('clientId')} label={t('integrations.m365App.clientLabel', 'Application (client) ID')} required code autoComplete="off" />
        <TextField
          {...form.fieldProps('clientSecret')}
          label={t('integrations.m365App.secretLabel', 'Client secret')}
          required={!ownApp}
          type="password"
          autoComplete="off"
          fullWidth
          helper={info.secretSet ? t('integrations.m365App.secretHelper', 'A secret is saved. Enter a new one only to replace it.') : undefined}
        />
      </FormGrid>
      {submitError && <FieldError id="m365-app-submit-error">{submitError}</FieldError>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" loading={saving}>
          {saving ? t('integrations.m365App.saving', 'Checking with Microsoft…') : t('integrations.m365App.save', 'Save app')}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          {t('integrations.m365App.cancel', 'Cancel')}
        </Button>
      </div>
    </form>
      <ConfirmDialog
        open={pending !== null}
        tone="destructive"
        title={t('integrations.m365App.changeTitle', 'Change the Microsoft app?')}
        description={t('integrations.m365App.changeDescription', 'Everyone in your organization will need to reconnect Microsoft 365.')}
        confirmLabel={t('integrations.m365App.changeConfirm', 'Save and reconnect everyone')}
        loading={saving}
        onConfirm={() => { if (pending) void send(pending); }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

export default M365AppRegistrationCard;
