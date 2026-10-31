/** FR-ODC-110: the Odoo connection card. Connect (masked key), pick the company once, then state, age, Re-check, Refresh now and Disconnect. */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, Card, ConfirmDialog, EntityFormModal, FormGrid, FormSection, Icon, ListState, SelectField, StatusPill, TextField, type StatusVariant } from '@/src/components/ui';
import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { displayedConnection } from '@/src/lib/adapterSeam/odoo/connectionState';
import { formatDateOnly, formatRelativeTime } from '@/src/lib/format';
import { useOdooConnect, useOdooConnection, useOdooDisconnect, useOdooSetup } from '@/src/hooks/useOdoo';
import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { AppError } from '@/src/lib/appError';
import { OdooConnectionBanner } from './OdooConnectionBanner';
import { odooErrorMessage } from './odooErrors';
import { useOdooCan } from './useOdooCan';

interface Credential { siteUrl: string; database: string; apiKey: string; keyExpiresOn: string | null; confirmDiscard?: boolean }
const BLANK = { siteUrl: '', database: '', apiKey: '', keyExpiresOn: '' };

export function OdooConnectionCard() {
  const { t } = useTranslation();
  const orgId = useAuth().currentUser?.org_id;
  const may = useOdooCan();
  const conn = useOdooConnection();
  const connect = useOdooConnect();
  const disconnect = useOdooDisconnect();
  const activate = useOdooSetup('activate');
  const recheck = useOdooSetup('recheck');
  const refresh = useOdooSetup('refresh');

  const [formOpen, setFormOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState('');
  // Held in memory only while the discard confirmation is open; never rendered, cleared on every outcome.
  const held = useRef<Credential | null>(null);

  const form = useEntityForm({ initialValues: BLANK, requiredFields: ['siteUrl', 'database', 'apiKey'], idPrefix: 'odoo-connect' });

  const read = conn.data;
  const active = read?.status === 'active';
  const notActivated = active && !read?.activated;
  const companies = useQuery({
    queryKey: ['odoo', 'companies', orgId],
    queryFn: () => repositories.odoo.setup<{ companies: Array<{ id: number; name: string }> }>('list-companies'),
    enabled: Boolean(orgId) && notActivated && may.manage,
    retry: false,
  });

  const submit = async (cred: Credential) => {
    setError(null);
    try {
      await connect.mutateAsync(cred);
      held.current = null;
      setConfirmDiscard(false);
      setFormOpen(false);
      form.reset(BLANK);
    } catch (err) {
      if (err instanceof AppError && err.code === 'confirm-discard') {
        held.current = cred;
        setConfirmDiscard(true);
      } else {
        held.current = null;
        setConfirmDiscard(false);
        setError(odooErrorMessage(t, err));
      }
    } finally {
      form.setValue('apiKey', '');   // the key never outlives the submit in the DOM
    }
  };
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(() => submit({
      siteUrl: form.values.siteUrl.trim(), database: form.values.database.trim(), apiKey: form.values.apiKey.trim(), keyExpiresOn: form.values.keyExpiresOn || null,
    }));
  };
  const run = async (m: { mutateAsync: (i: Record<string, unknown>) => Promise<unknown> }, input: Record<string, unknown> = {}) => {
    setError(null); setNotice(null);
    try { await m.mutateAsync(input); return true; } catch (err) { setError(odooErrorMessage(t, err)); return false; }
  };

  const state = read ? displayedConnection(read.connection, new Date(), { status: read.status, activated: read.activated }) : null;
  const pill: Record<string, { v: StatusVariant; label: string }> = {
    healthy: { v: 'won', label: t('administration:odoo.pill.healthy', 'Connected') },
    unverified: { v: 'neutral', label: t('administration:odoo.state.unverified', 'Not checked recently') },
    degraded: { v: 'warn', label: t('administration:odoo.pill.degraded', 'Needs attention') },
    'credential-expiring': { v: 'warn', label: t('administration:odoo.pill.expiring', 'Key expires soon') },
    unreachable: { v: 'lost', label: t('administration:odoo.pill.unreachable', 'Unreachable') },
    'credential-rejected': { v: 'lost', label: t('administration:odoo.pill.rejected', 'Key rejected') },
    'not-activated': { v: 'warn', label: t('administration:odoo.pill.notActivated', 'Choose a company') },
    disconnected: { v: 'neutral', label: t('administration:odoo.pill.disconnected', 'Not connected') },
  };
  const connectLabel = active ? t('administration:odoo.card.reconnect', 'Reconnect') : t('administration:odoo.card.connect', 'Connect Odoo');
  const list = companies.data?.companies ?? [];
  const chosen = companyId || (list.length === 1 ? String(list[0].id) : '');
  const cfg = read?.config ?? {};
  const expiry = typeof cfg.key_expires_on === 'string' ? cfg.key_expires_on : null;

  return (
    <Card className="p-4" data-tier="odoo" data-testid="odoo-card">
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="plug" aria-hidden="true" />
        <h3 className="text-[15px] font-semibold text-foreground">Odoo</h3>
        {state && <StatusPill variant={pill[state].v} className="min-w-0 max-w-full shrink whitespace-normal break-words">{pill[state].label}</StatusPill>}
      </div>

      {conn.isPending && <ListState variant="loading" rows={2} />}
      {conn.isError && <ListState variant="error" title={t('administration:odoo.card.loadFailed', 'Odoo status is unavailable')} onRetry={() => void conn.refetch()} retryLabel={t('administration:odoo.card.retry', 'Retry')} />}

      {read && (
        <div className="mt-3 space-y-3">
          {active && read.activated && <OdooConnectionBanner connection={read.connection} binding={{ status: read.status, activated: read.activated }} />}

          {active && read.activated && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{t('administration:odoo.card.company', 'Company')}</dt>
              <dd className="min-w-0 break-words font-medium text-foreground">{String(cfg.odoo_company_name ?? '')}</dd>
              <dt className="text-muted-foreground">{t('administration:odoo.card.database', 'Database')}</dt>
              <dd className="min-w-0 break-words font-medium text-foreground">{String(cfg.database ?? '')}</dd>
              {read.capabilities?.version_major != null && (<><dt className="text-muted-foreground">{t('administration:odoo.card.version', 'Odoo version')}</dt><dd className="font-medium text-foreground">{read.capabilities.version_major}</dd></>)}
              <dt className="text-muted-foreground">{t('administration:odoo.card.checked', 'Last check')}</dt>
              <dd className="font-medium text-foreground">{t('administration:odoo.card.checkedAgo', 'Checked {{age}}', { age: formatRelativeTime(read.connection?.last_checked_at) })}</dd>
              {expiry && (<><dt className="text-muted-foreground">{t('administration:odoo.card.keyExpires', 'Key expires')}</dt><dd className="font-medium text-foreground">{formatDateOnly(expiry)}</dd></>)}
            </dl>
          )}

          {!active && (
            <p className="text-sm text-muted-foreground">{t('administration:odoo.card.intro', 'Connect your Odoo to see its items, units, warehouses and accounts in PMO, and keep vendors and clients in step.')}</p>
          )}

          {notActivated && may.manage && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('administration:odoo.card.pickCompany', 'Choose the Odoo company PMO works with. It cannot be changed later.')}</p>
              {companies.isPending && <ListState variant="loading" rows={1} />}
              {companies.isError && <ListState variant="error" title={t('administration:odoo.card.companiesFailed', 'Companies could not be listed')} onRetry={() => void companies.refetch()} retryLabel={t('administration:odoo.card.retry', 'Retry')} />}
              {companies.isSuccess && list.length === 0 && <p role="status" className="text-sm text-muted-foreground">{t('administration:odoo.card.noCompanies', 'This key can see no Odoo companies. Check its access in Odoo, then reconnect.')}</p>}
              {list.length === 1 && <p className="text-sm font-medium text-foreground">{list[0].name}</p>}
              {list.length > 1 && (
                <SelectField label={t('administration:odoo.card.companyLabel', 'Company')} value={chosen} onChange={setCompanyId} placeholder={t('administration:odoo.card.companyPlaceholder', 'Select a company')}
                  options={list.map((c) => ({ value: String(c.id), label: c.name }))} />
              )}
              {list.length > 0 && (
                <Button size="sm" loading={activate.isPending} disabled={!chosen} onClick={() => void run(activate, { companyId: Number(chosen) })}>{t('administration:odoo.card.activate', 'Activate')}</Button>
              )}
            </div>
          )}
          {notActivated && !may.manage && <p className="text-sm text-muted-foreground">{t('administration:odoo.card.askAdmin', 'An administrator needs to choose the Odoo company.')}</p>}

          {error && !formOpen && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}

          <div className="flex flex-wrap items-center gap-2">
            {!active && may.manage && (
              <Button variant="outline" size="sm" onClick={() => { setError(null); form.reset(BLANK); setFormOpen(true); }}>
                <Icon name="plus" className="size-3.55" aria-hidden="true" />{t('administration:odoo.card.connect', 'Connect Odoo')}
              </Button>
            )}
            {active && read.activated && may.manage && (
              <Button variant="outline" size="sm" loading={recheck.isPending} onClick={() => void run(recheck).then((ok) => ok && setNotice(t('administration:odoo.card.rechecked', 'Checked just now.')))}>
                <Icon name="refresh" className="size-3.55" aria-hidden="true" />{t('administration:odoo.card.recheck', 'Re-check')}
              </Button>
            )}
            {active && read.activated && may.setValue && (
              <Button variant="outline" size="sm" loading={refresh.isPending} onClick={() => void run(refresh).then((ok) => ok && setNotice(t('administration:odoo.card.refreshed', 'Refresh started.')))}>
                <Icon name="refresh" className="size-3.55" aria-hidden="true" />{t('administration:odoo.card.refresh', 'Refresh now')}
              </Button>
            )}
            {active && read.activated && (
              <Link className="inline-flex min-h-9 items-center rounded-md px-2 text-sm text-primary underline underline-offset-4" to="/master-data/product">{t('administration:odoo.card.browse', 'Browse Odoo directories')}</Link>
            )}
            {active && may.manage && (
              <Button variant="outline" size="sm" onClick={() => { setError(null); form.reset(BLANK); setFormOpen(true); }}>
                {t('administration:odoo.card.reconnect', 'Reconnect')}
              </Button>
            )}
            {active && may.manage && (
              <Button variant="ghost" size="sm" onClick={() => setConfirmDisconnect(true)}>
                <Icon name="plug" className="size-3.55" aria-hidden="true" />{t('administration:odoo.card.disconnect', 'Disconnect Odoo')}
              </Button>
            )}
          </div>
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <Icon name="info" className="size-3.55 shrink-0" aria-hidden="true" />
            <span>{t('administration:odoo.card.location', 'Self-hosted or Odoo-hosted ERP: your data stays in your Odoo; PMO keeps a read copy of its directories.')}</span>
          </p>
        </div>
      )}

      {formOpen && (
        <EntityFormModal open title={connectLabel} subtitle={t('administration:odoo.connect.subtitle', 'Use an API key made for PMO in Odoo. PMO stores it encrypted and never shows it again.')}
          submitLabel={connectLabel} onSubmit={onSubmit} onClose={() => { setFormOpen(false); held.current = null; }}
          loading={connect.isPending} dirty={form.isDirty} submitDisabled={!form.isComplete}
          errorSummary={error ? [{ fieldId: form.fieldProps('siteUrl').id, message: error }] : undefined}>
          <FormSection legend={t('administration:odoo.connect.legend', 'Odoo connection')}>
            <FormGrid>
              <TextField {...form.fieldProps('siteUrl')} label={t('administration:odoo.connect.siteUrl', 'Site URL')} required placeholder="https://mycompany.odoo.com" autoComplete="off" fullWidth />
              <TextField {...form.fieldProps('database')} label={t('administration:odoo.connect.database', 'Database')} required autoComplete="off" />
              <TextField {...form.fieldProps('apiKey')} label={t('administration:odoo.connect.apiKey', 'API key')} required type="password" autoComplete="off" fullWidth />
              <TextField {...form.fieldProps('keyExpiresOn')} label={t('administration:odoo.connect.keyExpiresOn', 'Key expires on (optional)')} type="date" helper={t('administration:odoo.connect.expiryHelp', 'If you gave the key an expiry in Odoo, enter it so PMO can warn you before it lapses.')} />
            </FormGrid>
          </FormSection>
        </EntityFormModal>
      )}

      <ConfirmDialog open={confirmDiscard} tone="destructive" title={t('administration:odoo.discard.title', 'Switch to a different Odoo database')}
        description={t('administration:odoo.discard.body', 'This is a different Odoo database. Connecting discards what PMO mirrored from the old one (directories and links). Documents already sent are never touched.')}
        confirmLabel={t('administration:odoo.discard.confirm', 'Discard and connect')} loading={connect.isPending}
        onConfirm={() => { const c = held.current; if (c) void submit({ ...c, confirmDiscard: true }); }}
        onCancel={() => { held.current = null; setConfirmDiscard(false); }} />

      <ConfirmDialog open={confirmDisconnect} tone="destructive" title={t('administration:odoo.disconnect.title', 'Disconnect Odoo')}
        description={t('administration:odoo.disconnect.body', 'PMO stops syncing with Odoo and deletes the stored API key. What PMO already mirrored stays visible until you connect again.')}
        confirmLabel={t('administration:odoo.disconnect.confirm', 'Disconnect')} loading={disconnect.isPending}
        onConfirm={() => { void disconnect.mutateAsync().then(() => setConfirmDisconnect(false), (err) => { setConfirmDisconnect(false); setError(odooErrorMessage(t, err)); }); }}
        onCancel={() => setConfirmDisconnect(false)} />
    </Card>
  );
}
