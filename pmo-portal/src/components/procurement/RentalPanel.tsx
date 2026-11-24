import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, RecordSection, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useExtendRental, usePurchaseTypes, useRentalLinks } from '@/src/hooks/usePurchaseTypes';
import { formatDayRange } from '@/src/lib/format';
import RentalExtensionModal, { type ExtensionLine } from './RentalExtensionModal';

export interface RentalPanelProps {
  readOnly?: boolean;
  procurementId: string;
  title: string;
  status: string;
  purchaseTypeId: string;
  rentalFrom: string | null;
  rentalTo: string | null;
  extendsId: string | null;
  lines: ExtensionLine[];
}

const DEAD = new Set(['Cancelled', 'Rejected']);

/** The purchase's type, rental period, links both ways and the guided "Extend rental" step (FR-PTR-008/009/013). Mounted only on a typed purchase. */
const RentalPanel: React.FC<RentalPanelProps> = ({ readOnly = false, procurementId, title, status, purchaseTypeId, rentalFrom, rentalTo, extendsId, lines }) => {
  const { t, i18n } = useTranslation('purchaseTypes');
  const navigate = useNavigate();
  const { toast } = useToast();
  const may = usePermission();
  const types = usePurchaseTypes();
  const type = types.data?.find((x) => x.id === purchaseTypeId);
  const isRental = Boolean(type?.isRental) && Boolean(rentalFrom && rentalTo);
  const links = useRentalLinks(procurementId, extendsId, isRental);
  const extend = useExtendRental();
  const [open, setOpen] = useState(false);
  const typeName = type ? (i18n.language.startsWith('id') && type.nameId ? type.nameId : type.name) : null;
  const canExtend = !readOnly && isRental && !DEAD.has(status) && may('create', 'procurement');
  if (!typeName) return null;
  return (
    <RecordSection data-testid="rental-panel" title={t('panel.title', 'Purchase type')}
      actions={canExtend ? <Button variant="outline" size="sm" onClick={() => setOpen(true)}>{t('panel.extend', 'Extend rental')}</Button> : undefined}>
      <p className="text-sm"><span className="font-medium">{typeName}</span>{isRental && rentalFrom && rentalTo ? <span className="tabular"> · {formatDayRange(rentalFrom, rentalTo)}</span> : null}</p>
      {links.data?.extends && (
        <p className="mt-2 text-sm" data-testid="rental-extends">{t('panel.extends', 'Extends')}{' '}
          <Link className="text-primary-text hover:underline" to={`/procurement/${links.data.extends.id}`}>{links.data.extends.title}</Link>
          {links.data.extends.rentalFrom && links.data.extends.rentalTo ? <span className="tabular"> · {formatDayRange(links.data.extends.rentalFrom, links.data.extends.rentalTo)}</span> : null}
        </p>
      )}
      {links.data && links.data.extensions.length > 0 && (
        <div className="mt-2 text-sm" data-testid="rental-extensions">
          <p className="font-medium">{t('panel.extensions', 'Extensions')}</p>
          <ul className="space-y-1">
            {links.data.extensions.map((x) => (
              <li key={x.id}><Link className="text-primary-text hover:underline" to={`/procurement/${x.id}`}>{x.title}</Link>
                {x.rentalFrom && x.rentalTo ? <span className="tabular"> · {formatDayRange(x.rentalFrom, x.rentalTo)}</span> : null}</li>
            ))}
          </ul>
        </div>
      )}
      {open && rentalFrom && rentalTo && (
        <RentalExtensionModal title={title} rentalFrom={rentalFrom} rentalTo={rentalTo} lines={lines} onClose={() => setOpen(false)}
          onSave={(input) => extend.mutateAsync({ ...input, originalId: procurementId })}
          onDone={(newId) => { setOpen(false); toast(t('extend.created', 'Extension order created'), t('extend.createdSub', 'It is a draft. Send it for approval like any other order.'), 'success'); navigate(`/procurement/${newId}`); }} />
      )}
    </RecordSection>
  );
};
export default RentalPanel;
