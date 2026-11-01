/**
 * AC-ODC-050/054, FR-ODC-070/112: a project's Odoo cost account. A project links to an account of the chosen plan (Odoo's
 * Project app is never involved); the Admin or the project's own manager links and unlinks. Reads PMO's mirror, so it works
 * while Odoo is down. The server decides who may link (`link_odoo_cost_account`); the controls here are only the UX.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ListState, SelectField, StatusPill } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useOdooProjectLinks, useOdooSetup } from '@/src/hooks/useOdoo';
import { odooErrorMessage } from '@/src/components/integrations/odoo/odooErrors';

export function ProjectOdooLink({ projectId, managerId }: { projectId: string; managerId: string | null }) {
  const { t } = useTranslation();
  const me = useAuth().currentUser;
  const { realRole, effectiveRole } = useEffectiveRole();
  const links = useOdooProjectLinks();
  const link = useOdooSetup('link-project');
  const unlink = useOdooSetup('unlink-project');
  const setPlan = useOdooSetup('set-analytic-plan');
  const [account, setAccount] = useState('');
  const [plan, setPlanId] = useState('');
  const [error, setError] = useState<string | null>(null);

  // View-only while impersonating; otherwise the Admin, or the project's own manager.
  const mayLink = realRole === effectiveRole && (realRole === 'Admin' || (realRole === 'Project Manager' && Boolean(me?.id) && managerId === me?.id));
  const run = async (m: { mutateAsync: (i: Record<string, unknown>) => Promise<unknown> }, input: Record<string, unknown>, after?: () => void) => {
    setError(null);
    try { await m.mutateAsync(input); after?.(); } catch (err) { setError(odooErrorMessage(t, err)); }
  };

  const title = <h4 className="text-xs font-medium text-muted-foreground">{t('administration:odoo.projectLink.title', 'Odoo cost account')}</h4>;
  if (links.isPending) return <div>{title}<ListState variant="loading" rows={1} /></div>;
  if (links.isError || !links.data) {
    return <div>{title}<ListState variant="error" title={t('administration:odoo.projectLink.loadFailed', 'The Odoo link could not be loaded')} onRetry={() => void links.refetch()} retryLabel={t('administration:odoo.projectLink.retry', 'Retry')} /></div>;
  }
  const { planId, plans = [], accounts, linked } = links.data;
  const mine = linked.find((l) => l.projectId === projectId);
  const taken = new Set(linked.map((l) => l.accountId));
  const name = (id: string) => { const a = accounts.find((x) => x.id === id); return a ? [a.code, a.name].filter(Boolean).join(' ') : id; };
  const why: Record<string, string> = {
    archived: t('administration:odoo.projectLink.archived', 'The cost account was archived in Odoo.'),
    tombstoned: t('administration:odoo.projectLink.tombstoned', 'The cost account was deleted in Odoo.'),
    'moved-company': t('administration:odoo.projectLink.moved', 'The cost account moved to another Odoo company.'),
  };

  return (
    <div className="space-y-2" data-testid="project-odoo-link">
      {title}
      {mine ? (
        <div className="space-y-1.5">
          <p className="break-words text-sm font-medium text-foreground">{name(mine.accountId)}</p>
          {mine.attention && (
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              <StatusPill variant="warn">{t('administration:odoo.mapOnce.attention', 'Needs attention')}</StatusPill>
              <span>{why[mine.attention] ?? t('administration:odoo.projectLink.attention', 'The cost account needs a look in Odoo.')}</span>
            </p>
          )}
          {mayLink && <Button size="sm" variant="outline" loading={unlink.isPending} onClick={() => void run(unlink, { projectId })}>{t('administration:odoo.projectLink.unlink', 'Unlink')}</Button>}
        </div>
      ) : planId === null ? (
        mayLink && realRole === 'Admin' ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t('administration:odoo.projectLink.choosePlan', 'Choose the Odoo analytic plan whose accounts are your projects. This is done once.')}</p>
            <SelectField label={t('administration:odoo.projectLink.plan', 'Analytic plan')} value={plan} onChange={setPlanId} options={plans.map((p) => ({ value: p.id, label: p.name }))} placeholder={t('administration:odoo.mapOnce.choose', 'Choose…')} fullWidth />
            <Button size="sm" loading={setPlan.isPending} disabled={!plan} onClick={() => void run(setPlan, { planId: plan })}>{t('administration:odoo.projectLink.usePlan', 'Use this plan')}</Button>
          </div>
        ) : <p className="text-sm text-muted-foreground">{t('administration:odoo.projectLink.askAdmin', 'Not linked yet. Ask an administrator to choose the Odoo analytic plan first.')}</p>
      ) : mayLink ? (
        <div className="space-y-2">
          <SelectField label={t('administration:odoo.projectLink.account', 'Cost account')} value={account} onChange={setAccount} placeholder={t('administration:odoo.mapOnce.choose', 'Choose…')}
            options={accounts.filter((a) => !taken.has(a.id)).map((a) => ({ value: a.id, label: [a.code, a.name].filter(Boolean).join(' ') }))} fullWidth />
          <Button size="sm" loading={link.isPending} disabled={!account} onClick={() => void run(link, { projectId, accountId: account }, () => setAccount(''))}>{t('administration:odoo.projectLink.link', 'Link')}</Button>
        </div>
      ) : <p className="text-sm text-muted-foreground">{t('administration:odoo.projectLink.notLinked', 'Not linked to an Odoo cost account.')}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
