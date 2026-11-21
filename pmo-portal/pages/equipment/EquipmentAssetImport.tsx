import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImportButton } from '@/src/components/import';
import { makeEquipmentImportDescriptor } from '@/src/lib/import';
import { repositories } from '@/src/lib/repositories';

/**
 * "Import" on the asset list (#2530). Suppliers for the rental column are read once, through the repository (RLS scopes
 * them); a failed read leaves the list empty, so a rented row then names its supplier as not found rather than blocking.
 */
export function EquipmentAssetImport({ onImported }: { onImported: () => void }) {
  const { t } = useTranslation();
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const rows = await repositories.company.list({ type: 'Vendor' });
        if (live) setVendors(rows.map((v) => ({ id: v.id, name: v.name })));
      } catch { /* the import still opens; supplier names will not resolve */ }
    })();
    return () => { live = false; };
  }, []);
  const descriptor = useMemo(
    () => makeEquipmentImportDescriptor(vendors, async () => (await repositories.equipment.listAssets()).rows.map((a) => a.code), undefined, t),
    [vendors, t],
  );
  return <ImportButton entity="equipmentAsset" descriptor={descriptor} onImported={onImported} />;
}
