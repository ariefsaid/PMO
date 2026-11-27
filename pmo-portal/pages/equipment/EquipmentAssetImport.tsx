import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListState } from "@/src/components/ui";
import { ImportButton } from '@/src/components/import';
import { makeEquipmentImportDescriptor } from '@/src/lib/import';
import { repositories } from '@/src/lib/repositories';

/**
 * "Import" on the asset list (#2530). Suppliers for the rental column are read once, through the repository (RLS scopes
 * them); the importer opens once the supplier choices are available.
 */
export function EquipmentAssetImport({ onImported }: { onImported: () => void }) {
  const { t } = useTranslation();
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  useEffect(() => {
    setState("loading");
    let live = true;
    void (async () => {
      try {
        const rows = await repositories.company.list({ type: 'Vendor' });
        if (live) { setVendors(rows.map((v) => ({ id: v.id, name: v.name }))); setState("ready"); }
      } catch { if (live) setState("error"); }
    })();
    return () => { live = false; };
  }, [attempt]);
  const descriptor = useMemo(
    () => makeEquipmentImportDescriptor(vendors, async () => (await repositories.equipment.listAssets()).rows.map((a) => a.code), undefined, t),
    [vendors, t],
  );
  if (state === "error") return <ListState variant="error" title={t("common:ui.errorBoundary.title", "Something went wrong")} onRetry={() => setAttempt((n) => n + 1)} />;
  if (state === "loading") return <ListState variant="loading" />;
  return <ImportButton entity="equipmentAsset" descriptor={descriptor} onImported={onImported} />;
}
