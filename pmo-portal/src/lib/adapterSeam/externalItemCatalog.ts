/** Tier-keyed routing for external item catalogues. Implementations stay beside their tier adapter. */
export type ExternalItemCatalogProvider = 'erpnext' | 'odoo';

const PROVIDER_BY_TIER = {
  erpnext: 'erpnext',
  odoo: 'odoo',
} as const satisfies Record<ExternalItemCatalogProvider, ExternalItemCatalogProvider>;

export type ExternalItemCatalogReaders<T> = Record<ExternalItemCatalogProvider, () => Promise<T>>;

/** Dispatch a catalogue read by the configured owning tier; unknown tiers fail closed. */
export async function readExternalItemCatalog<T>(tier: unknown, readers: ExternalItemCatalogReaders<T>): Promise<T | null> {
  if (typeof tier !== 'string') return null;
  const provider = Object.getOwnPropertyDescriptor(PROVIDER_BY_TIER, tier)?.value as ExternalItemCatalogProvider | undefined;
  return provider ? readers[provider]() : null;
}
