import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ImportButton } from '@/src/components/import';
import { makePersonDocumentImportDescriptor } from '@/src/lib/import';
import { repositories } from '@/src/lib/repositories';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { usePeople } from '@/src/hooks/usePeople';

/**
 * Person document import (one template: person code, document type, number, issue date, expiry date). Shown to whoever
 * `can('create', 'expiryDocument')` for a non-medical person document: the one rule the person page's
 * Add document uses, so it follows that rule wherever it goes. UX only; RLS refuses anyone else per row.
 */
export const PersonDocumentImport: React.FC<{ onImported: () => void }> = ({ onImported }) => {
  const { t } = useTranslation();
  const { realRole, effectiveRole } = useEffectiveRole();
  const ctx = useMemo(() => ({ record: { kind: 'person' as const, medical: false, viewOnly: realRole !== effectiveRole } }), [realRole, effectiveRole]);
  const allowed = usePermission()('create', 'expiryDocument', ctx);
  const types = useQuery({ queryKey: ['document-types', 'person'], queryFn: () => repositories.documentExpiry.listTypes('person'), enabled: allowed, staleTime: 5 * 60_000 });
  // Live people always, whichever staff view the register shows: a code used only by a former person has no document to import.
  const peopleQ = usePeople('active');
  const live = useMemo(() => (peopleQ.data ?? []).map((p) => ({ id: p.id, code: p.code })), [peopleQ.data]);
  const descriptor = useMemo(
    () => makePersonDocumentImportDescriptor({ people: live, types: types.data ?? [], documents: () => repositories.documentExpiry.listPersonDocuments() }, t),
    [live, types.data, t],
  );
  if (!allowed) return null;
  return (
    <ImportButton entity="expiryDocument" permissionCtx={ctx} descriptor={descriptor}
      label={t('administration:people.importDocuments', 'Import documents')} onImported={onImported} />
  );
};
