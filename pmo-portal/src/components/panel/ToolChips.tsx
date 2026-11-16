/**
 * ToolChips — compact evidence for a run of tool-call AgentEvents: one chip per call with a
 * human-readable label instead of the raw payload JSON.
 * D-A2-7: "Looked up {entity} · N rows" pattern; never raw JSON. FR-AP-015; AC-AP-013.
 * Adapted from MIT-licensed sources; notice in ./THIRD_PARTY_NOTICE.md.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Icon } from '@/src/components/ui/icons';

/** Derives a human-readable label from the tool payload (single source of truth). */
function toolLabel(payload: unknown, t: TFunction<'assistantPanel'>): string {
  const p = payload as { entity?: string; rowCount?: number } | undefined;
  if (p?.entity) {
    const entity = t(`entities.${p.entity}`, { defaultValue: p.entity });
    return typeof p.rowCount === 'number'
      ? t('toolChips.lookedUpRows', { entity, count: p.rowCount, defaultValue: 'Looked up {{entity}} · {{count}} rows' })
      : t('toolChips.lookedUp', { entity, defaultValue: 'Looked up {{entity}}' });
  }
  return t('toolChips.checking', 'Checking your data…');
}

export const ToolChips: React.FC<{ payloads: unknown[] }> = ({ payloads }) => {
  const { t } = useTranslation('assistantPanel');
  return (
  <ul className="flex flex-wrap gap-1.5">
    {payloads.map((payload, i) => (
      <li
        key={i}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-sm text-muted-foreground"
      >
        <Icon name="check" aria-hidden className="size-3.5 shrink-0" />
        <span className="tabular-nums">{toolLabel(payload, t)}</span>
      </li>
    ))}
  </ul>
  );
};
