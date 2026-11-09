/**
 * Odoo's one-time record review (#2050, FR-ODC-110/112/113): PMO proposes what to link, bring in and send, the Admin accepts all
 * in one step and answers only the unclear rows (owner rule 2026-10-16). Admin only: the server lets Finance read the setup run
 * for accounts alone, and Odoo has no account matching yet. The tier-keyed review and send states are the ERPNext ones.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, ListState, SelectField } from '@/src/components/ui';
import { repositories } from '@/src/lib/repositories';
import { useOdooConnection, useOdooProjectLinks, useOdooSetup } from '@/src/hooks/useOdoo';
import { ConnectProposalReview } from '../ConnectProposalReview';
import { ErpSendStates } from '../ErpSendStates';
import { odooErrorMessage } from './odooErrors';
import { useOdooCan } from './useOdooCan';

/** The analytic plan that holds one cost account per project. Until it is chosen the census cannot propose to send projects. */
function OdooPlanChoice() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const links = useOdooProjectLinks();
  const setPlan = useOdooSetup('set-analytic-plan');
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [censusFailed, setCensusFailed] = useState(false);

  if (links.isPending) return <ListState variant="loading" rows={1} />;
  if (links.isError || !links.data) {
    return <ListState variant="error" title={t('administration:odoo.records.planLoadFailed', 'The analytic plans could not be loaded')} onRetry={() => void links.refetch()} retryLabel={t('administration:odoo.projectLink.retry', 'Retry')} />;
  }
  const { planId, plans = [] } = links.data;
  // Once the plan is saved the choice disappears; a failed census start stays visible so the Admin knows to press Check again.
  if (planId !== null) return censusFailed ? <p role="alert" className="text-sm text-destructive-text">{t('administration:odoo.records.censusFailed', 'Projects could not be checked yet. Press Check again.')}</p> : null;

  const choose = async (id: string) => {
    setError(null);
    setBusy(true);
    try {
      await setPlan.mutateAsync({ planId: id });
    } catch (err) {
      setError(odooErrorMessage(t, err));
      setBusy(false);
      return;
    }
    // With a plan chosen, PMO's projects can be proposed as sends: read both sides again. The review only shows the previous run, so a failed start is said here.
    try { await repositories.integrations.startConnectCensus('odoo'); } catch { setCensusFailed(true); }
    void qc.invalidateQueries({ queryKey: ['integrations', 'connect-status', 'odoo'] });
    void qc.invalidateQueries({ queryKey: ['integrations', 'connect-proposals', 'odoo'] });
    setBusy(false);
  };

  return (
    <div className="space-y-2" data-testid="odoo-plan-choice">
      <h4 className="text-sm font-semibold text-foreground">{t('administration:odoo.records.planTitle', 'Project cost accounts')}</h4>
      {plans.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('administration:odoo.records.planNone', 'Odoo has no analytic plan yet. Add one in Odoo, then check again.')}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t('administration:odoo.records.planIntro', 'Choose the Odoo analytic plan that holds one account per project. PMO sends each project there. This is done once.')}</p>
          {plans.length === 1 ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 break-words text-muted-foreground">{t('administration:odoo.records.planProposed', 'Proposed: {{name}}', { name: plans[0].name })}</span>
              <Button size="sm" variant="outline" loading={busy} onClick={() => { void choose(plans[0].id); }}>
                {t('administration:odoo.records.planUseNamed', 'Use {{name}}', { name: plans[0].name })}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <SelectField label={t('administration:odoo.projectLink.plan', 'Analytic plan')} value={picked} onChange={setPicked} options={plans.map((p) => ({ value: p.id, label: p.name }))} placeholder={t('administration:odoo.mapOnce.choose', 'Choose…')} />
              <Button size="sm" variant="outline" loading={busy} disabled={!picked} onClick={() => { void choose(picked); }}>{t('administration:odoo.projectLink.usePlan', 'Use this plan')}</Button>
            </div>
          )}
        </>
      )}
      {error && <p role="alert" className="text-sm text-destructive-text">{error}</p>}
    </div>
  );
}

export function OdooRecordsSetup() {
  const { t } = useTranslation();
  const may = useOdooCan();
  const read = useOdooConnection().data;
  if (!may.manage || read?.status !== 'active' || !read.activated) return null;
  return (
    <section aria-label={t('administration:odoo.records.title', 'Records in PMO and Odoo')} className="mt-3 space-y-4" data-testid="odoo-records-setup">
      <OdooPlanChoice />
      <ConnectProposalReview tier="odoo" />
      <ul className="text-sm"><ErpSendStates enabled tier="odoo" /></ul>
    </section>
  );
}
