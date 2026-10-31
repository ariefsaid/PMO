/** AC-ODC-015: the one place that turns the stored Odoo connection record into words. Healthy and fresh renders nothing. */
import { useTranslation } from 'react-i18next';
import { Icon } from '@/src/components/ui';
import { formatClockTime } from '@/src/lib/format';
import { displayedConnection, type ConnectionRecord } from '@/src/lib/adapterSeam/odoo/connectionState';

export interface OdooConnectionBannerProps {
  connection: ConnectionRecord | null;
  binding: { status: string; activated: boolean };
  now?: Date;
}

export function OdooConnectionBanner({ connection, binding, now = new Date() }: OdooConnectionBannerProps) {
  const { t } = useTranslation();
  const state = displayedConnection(connection, now, binding);
  if (state === 'healthy') return null;
  const asOf = connection?.last_checked_at
    ? t('administration:odoo.banner.asOf', 'as of {{time}}', { time: formatClockTime(new Date(connection.last_checked_at)) })
    : '';
  const missing = (connection?.missing ?? []).join(', ');
  const copy: Record<string, { title: string; next: string; tone: 'warn' | 'bad' | 'info' }> = {
    unverified: { title: t('administration:odoo.state.unverified', 'Not checked recently'), next: t('administration:odoo.banner.unverifiedNext', 'The last check was a while ago. Use Re-check to confirm the connection.'), tone: 'info' },
    unreachable: { title: t('administration:odoo.state.unreachable', 'Odoo cannot be reached'), next: t('administration:odoo.banner.unreachableNext', 'Directories show the last synced data. PMO keeps trying; check that your Odoo is online.'), tone: 'bad' },
    'credential-rejected': { title: t('administration:odoo.state.credentialRejected', 'Odoo rejected the API key'), next: t('administration:odoo.banner.rejectedNext', 'An administrator needs to reconnect with a valid API key.'), tone: 'bad' },
    degraded: { title: t('administration:odoo.state.degraded', 'Some Odoo apps are missing'), next: t('administration:odoo.banner.degradedNext', 'Missing: {{missing}}. Install them in Odoo, then Re-check.', { missing }), tone: 'warn' },
    'credential-expiring': { title: t('administration:odoo.state.credentialExpiring', 'The API key expires soon'), next: t('administration:odoo.banner.expiringNext', 'Create a new key in Odoo and reconnect before it expires.'), tone: 'warn' },
    'not-activated': { title: t('administration:odoo.state.notActivated', 'Choose the Odoo company to finish connecting'), next: t('administration:odoo.banner.notActivatedNext', 'Syncing starts once a company is chosen.'), tone: 'info' },
    disconnected: { title: t('administration:odoo.state.disconnected', 'Odoo is not connected'), next: t('administration:odoo.banner.disconnectedNext', 'An administrator can connect it under Administration, Integrations.'), tone: 'info' },
  };
  const c = copy[state];
  const tone = c.tone === 'bad' ? 'border-destructive/30 bg-destructive/[0.07]' : c.tone === 'warn' ? 'border-warning/40 bg-warning/12' : 'border-border bg-muted/40';
  return (
    <div role="status" data-testid="odoo-connection-banner" data-state={state} className={`mb-3.5 flex items-start gap-2.5 rounded-lg border px-3.5 py-3 ${tone}`}>
      <Icon name={c.tone === 'info' ? 'info' : 'alert'} className="mt-px size-[17px] shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-[13px]">
        <div className="font-semibold text-foreground">{c.title}{asOf && state !== 'disconnected' && state !== 'not-activated' ? ` (${asOf})` : ''}</div>
        <div className="mt-px text-muted-foreground">{c.next}</div>
      </div>
    </div>
  );
}
