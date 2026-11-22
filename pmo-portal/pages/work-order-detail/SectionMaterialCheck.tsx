import React from 'react';
import { useTranslation } from 'react-i18next';
import { useTerms } from '@/src/lib/i18n/terms';
import { useStockItems } from '@/src/hooks/useStock';
import { useSectionMaterialCheck } from '@/src/hooks/useWorkOrderSectionMaterials';

interface Props {
  workOrderId: string;
  /** code and name by section id, from the roll-up the block already holds. */
  sections: Array<{ id: string; code: string }>;
}

/**
 * The material check per section and item (FR-WOS-014): the section's plan (its allocation), what is requested on it
 * (pending, approved, fulfilled) and what remains; the same three for what is not in a section. An item whose
 * allocations exceed the work order's plan now is flagged, never rewritten. Absent entirely when the read is not
 * available or there is nothing to show; a failed read never breaks the sections block.
 */
export const SectionMaterialCheck: React.FC<Props> = ({ workOrderId, sections }) => {
  const { t } = useTranslation('workOrderSections');
  const terms = useTerms();
  const check = useSectionMaterialCheck(workOrderId);
  const items = useStockItems();
  const rows = check.data ?? [];
  if (check.isPending || check.isError || rows.length === 0) return null;
  const itemName = (id: string) => items.data?.find((i) => i.id === id)?.name ?? '—';
  const codeOf = (id: string | null) => (id === null ? t('remainder', 'Not in a {{section}}', { section: terms.section.toLowerCase() }) : sections.find((s) => s.id === id)?.code ?? '—');
  const num = (v: number | null) => (v === null ? '—' : String(v));
  const flagged = new Set(rows.filter((r) => r.overAllocated).map((r) => r.itemId));
  return (
    <details className="mt-4" data-testid="wo-sections-material">
      <summary className="cursor-pointer text-control font-medium">{t('materials.title', 'Material check')}</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-control">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="py-1 pr-3 font-normal">{terms.section}</th>
              <th scope="col" className="py-1 pr-3 font-normal">{t('materials.item', 'Item')}</th>
              <th scope="col" className="py-1 pr-3 text-right font-normal">{t('materials.plan', 'Plan')}</th>
              <th scope="col" className="py-1 pr-3 text-right font-normal">{t('materials.requested', 'Requested')}</th>
              <th scope="col" className="py-1 text-right font-normal">{t('materials.remaining', 'Remaining')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.sectionId ?? 'none'}-${r.itemId}`} className="border-t border-border" data-testid={`wo-material-${r.sectionId === null ? 'remainder' : codeOf(r.sectionId)}-${r.itemId}`}>
                <th scope="row" className="py-1 pr-3 text-left font-normal">{codeOf(r.sectionId)}</th>
                <td className="py-1 pr-3">{itemName(r.itemId)}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{num(r.planQty)}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{num(r.requestedQty)}</td>
                <td className="py-1 text-right tabular-nums">{num(r.remainingQty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {flagged.size > 0 && (
          <p role="status" className="mt-2 text-control text-warning-foreground" data-testid="wo-material-over-allocated">
            {t('materials.overAllocated', '{{items}} is allocated above the work-order plan.', { items: [...flagged].map(itemName).join(', ') })}
          </p>
        )}
      </div>
    </details>
  );
};
