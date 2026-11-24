import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from '@/src/components/ui';
import { ImportWizard } from '@/src/components/import';
import { usePermission } from '@/src/auth/usePermission';
import { repositories } from '@/src/lib/repositories';
import { makeWorkOrderImportDescriptor, type ImportDescriptor, type WorkOrderImportInput } from '@/src/lib/import';
import { useWorkOrderLists } from '@/src/hooks/useWorkOrderLists';

interface Props {
  projectId: string;
  currency: string;
  /** Called after a successful import so the orders list reloads. */
  onImported: () => void;
}

/**
 * "Import work orders" on a project's customer orders (FR-WOI-001): the same wizard as the other imports, with a template,
 * a validated preview and one all-or-nothing confirm. The button shows only to who may create a work order (`can()` is UX;
 * the database refuses anyone else). The project's contract lines and client references are read when the button is pressed,
 * so the preview can name an unknown item code or a reference already on the project.
 */
export const WorkOrderImport: React.FC<Props> = ({ projectId, currency, onImported }) => {
  const { t } = useTranslation('project');
  const may = usePermission();
  const lists = useWorkOrderLists();
  const [descriptor, setDescriptor] = useState<ImportDescriptor<WorkOrderImportInput> | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  if (!may('create', 'workOrder')) return null;

  const open = async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [boq, orders] = await Promise.all([repositories.progressBilling.listBoq(projectId), repositories.workOrder.list(projectId)]);
      setDescriptor(makeWorkOrderImportDescriptor({
        projectId, currency,
        areas: lists.liveAreas.map((a) => ({ id: a.id, code: a.code, name: a.name })),
        boqLines: boq.map((b) => ({ id: b.id, itemCode: b.item_code, quantity: Number(b.quantity) })),
        existingReferences: async () => orders.flatMap((o) => (o.client_po_number ? [o.client_po_number] : [])),
      }, t));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button id="import-work-orders" variant="outline" size="sm" onClick={() => void open()} disabled={loading}>
        <Icon name="upload" />
        {t('projectDetail.workOrders.action.import', 'Import work orders')}
      </Button>
      {loadFailed && <span role="alert" className="text-sm text-destructive">{t('projectDetail.workOrders.importLoadFailed', 'Could not open the import. Try again.')}</span>}
      {descriptor && (
        <ImportWizard
          descriptor={descriptor}
          onClose={(didImport) => { setDescriptor(null); if (didImport) onImported(); }}
        />
      )}
    </>
  );
};
