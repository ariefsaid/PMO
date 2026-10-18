import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, Drawer } from '@/src/components/ui';

export interface ProjectBillingStartProps {
  projectId: string;
  clientId: string | null;
  onWorkOrder: () => void;
  /** The existing quantity-claim path is offered only when its current gate allows it. */
  onQuantity?: () => void;
}

const methodClassName = 'flex min-h-12 w-full flex-col items-start justify-center rounded-md border border-input bg-background px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

const ProjectBillingStart: React.FC<ProjectBillingStartProps> = ({ projectId, clientId, onWorkOrder, onQuantity }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (!clientId) return null;

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        {t('uxs15.startInvoice', 'Start invoice')}
      </Button>
      <Drawer
        open={open}
        title={t('uxs15.methodTitle', 'Start invoice')}
        subtitle={t('uxs15.methodIntro', 'Choose what you are invoicing. The project and its customer carry forward.')}
        onClose={() => setOpen(false)}
      >
        <div className="flex flex-col gap-2.5 overflow-y-auto p-4">
          <Link
            to={`/sales-invoices?create=1&project=${encodeURIComponent(projectId)}`}
            onClick={() => setOpen(false)}
            className={methodClassName}
          >
            <span className="text-sm font-semibold text-foreground">{t('uxs15.contractInvoice', 'Contract invoice')}</span>
            <span className="mt-0.5 text-xs text-muted-foreground">
              {t('uxs15.contractInvoiceHelp', 'Create a draft invoice for this project’s customer.')}
            </span>
          </Link>
          <button type="button" onClick={() => { setOpen(false); onWorkOrder(); }} className={methodClassName}>
            <span className="text-sm font-semibold text-foreground">{t('uxs15.customerWorkOrder', 'Customer work order')}</span>
            <span className="mt-0.5 text-xs text-muted-foreground">
              {t('uxs15.customerWorkOrderHelp', 'Choose a work order, then invoice its remaining value.')}
            </span>
          </button>
          {onQuantity && (
            <button type="button" onClick={() => { setOpen(false); onQuantity(); }} className={methodClassName}>
              <span className="text-sm font-semibold text-foreground">
                {t('uxs15.quantityProgressClaim', 'Quantity or progress claim')}
              </span>
              <span className="mt-0.5 text-xs text-muted-foreground">
                {t('uxs15.quantityProgressClaimHelp', 'Start a claim from measured work or a down payment.')}
              </span>
            </button>
          )}
        </div>
      </Drawer>
    </>
  );
};

export default ProjectBillingStart;
