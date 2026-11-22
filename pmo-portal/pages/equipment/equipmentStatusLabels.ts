import type { useTranslation } from 'react-i18next';
import type { EquipmentStatus } from '@/src/lib/equipmentMetrics';

export const STATUSES: EquipmentStatus[] = ['ready', 'standby', 'broken', 'at_vendor', 'waiting_parts'];

/** Static t() calls so the catalogue gates see every key (the pattern of `equipmentLabels`). */
export function statusLabel(t: ReturnType<typeof useTranslation>['t'], s: EquipmentStatus): string {
  switch (s) {
    case 'ready': return t('equipment:availability.status.ready', 'Ready');
    case 'standby': return t('equipment:availability.status.standby', 'Standby');
    case 'broken': return t('equipment:availability.status.broken', 'Broken');
    case 'at_vendor': return t('equipment:availability.status.at_vendor', 'At vendor');
    case 'waiting_parts': return t('equipment:availability.status.waiting_parts', 'Waiting for parts');
  }
}

/** One line per status saying what it does to planning (the 2526 rules: only the three down statuses leave availability). */
export function statusEffect(t: ReturnType<typeof useTranslation>['t'], s: EquipmentStatus): string {
  switch (s) {
    case 'ready': return t('equipment:availability.effect.ready', 'Counts as available. Plan it for work.');
    case 'standby': return t('equipment:availability.effect.standby', 'Counts as available, not working. Plan it as spare.');
    case 'broken': return t('equipment:availability.effect.broken', 'Not available. Leave it out of plans; counts as downtime.');
    case 'at_vendor': return t('equipment:availability.effect.at_vendor', 'Not available while it is at the vendor. Counts as downtime.');
    case 'waiting_parts': return t('equipment:availability.effect.waiting_parts', 'Not available until the parts arrive. Counts as downtime.');
  }
}
