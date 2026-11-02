import type { TFunction } from 'i18next';

/** Static t() calls so the catalogue gates see every key (the pattern of `budgetCategoryLabel`). */
export function basisLabel(t: TFunction, basis: string): string {
  switch (basis) {
    case 'hire_rate': return t('equipment:basis.hire_rate', 'Hire rate');
    case 'actual_cost': return t('equipment:basis.actual_cost', 'Actual cost by usage');
    case 'none': return t('equipment:basis.none', 'None');
    default: return basis;
  }
}
export function driverLabel(t: TFunction, driver: string | null): string {
  switch (driver) {
    case 'units': return t('equipment:driver.units', 'units');
    case 'fuel': return t('equipment:driver.fuel', 'fuel litres');
    case 'trips': return t('equipment:driver.trips', 'trips');
    default: return driver ?? '';
  }
}
export function unitLabel(t: TFunction, unit: string | null): string {
  return unit === 'days' ? t('equipment:unit.days', 'days') : t('equipment:unit.hours', 'hours');
}
