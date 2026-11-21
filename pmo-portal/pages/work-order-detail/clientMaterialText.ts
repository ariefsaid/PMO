import type { TFunction } from 'i18next';
import { clientRequisitionRefusal, type ClientRequisitionRefusal } from '@/src/lib/repositories/clientRequisitions';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatNumberExact, parseMoneyInputAtScale } from '@/src/lib/format';
import type { SubmitError } from '@/src/components/ui';

/**
 * The words for a refused client-material write (spec Errors table). The database decides; this only translates its
 * stable refusal key. Every key is LITERAL so the i18n completeness gate scans it.
 */
export function refusalMessage(t: TFunction, key: ClientRequisitionRefusal, quantity: string | null): string | null {
  const n = quantity === null ? '' : formatNumberExact(Number(quantity));
  switch (key) {
    case 'overRequested': return t('clientMaterial.refusal.overRequested', 'Reserved would exceed requested by {{n}}.', { n });
    case 'releaseBelowCollected': return t('clientMaterial.refusal.releaseBelowCollected', 'A release cannot take reserved below the {{n}} already collected.', { n });
    case 'overCollect': return t('clientMaterial.refusal.overCollect', 'Only {{n}} is still to collect.', { n });
    case 'notClientSupplied': return t('clientMaterial.refusal.notClientSupplied', 'This item is not client-supplied.');
    case 'notKeeper': return t('clientMaterial.refusal.notKeeper', 'You do not keep this location.');
    case 'ownedByErp': return t('clientMaterial.refusal.ownedByErp', 'Stock is run in your connected ERP, so a pickup cannot be recorded here.');
    case 'workOrder': return t('clientMaterial.refusal.workOrder', 'This work order is closed or cancelled.');
    case 'cancelled': return t('clientMaterial.refusal.cancelled', 'This requisition is cancelled.');
    case 'notOpen': return t('clientMaterial.refusal.notOpen', 'Send the requisition first.');
    case 'notDraft': return t('clientMaterial.refusal.notDraft', 'Only a draft requisition can be changed or sent.');
    case 'hasPickup': return t('clientMaterial.refusal.hasPickup', 'A pickup is already posted, so this requisition cannot be cancelled.');
    case 'forbidden': return t('clientMaterial.refusal.forbidden', 'Your role cannot do this.');
    case 'allocation': return t('clientMaterial.refusal.allocation', 'That contract line belongs to another work order.');
    case 'otherProject': return t('clientMaterial.refusal.otherProject', 'That location belongs to another project.');
    case 'noProject': return t('clientMaterial.refusal.noProject', 'Choose a site, yard or staging location of this project.');
    case 'notFound': return t('clientMaterial.refusal.notFound', 'That record is not available to you.');
    default: return null;
  }
}

/** A rejected write as the dialog's persistent error region reads it: our words first, the generic classifier otherwise. */
export function toSubmitError(t: TFunction, err: unknown): SubmitError {
  const { key, quantity } = clientRequisitionRefusal(err);
  const message = refusalMessage(t, key, quantity);
  if (message) return { headline: message };
  const c = classifyMutationError(err, undefined, { suppressCapture: true });
  return { headline: c.headline, detail: c.detail };
}

/** A quantity a person typed: above 0, at most 3 decimals, as the exact string the RPC receives. */
export function readQuantity(raw: string): string | null {
  const n = parseMoneyInputAtScale(raw.trim(), 3);
  return n === null || n <= 0 ? null : String(n);
}

export interface Option { value: string; label: string }
