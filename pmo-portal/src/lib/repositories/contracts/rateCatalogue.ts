import type { CatalogueItem, CatalogueItemInput, CatalogueRate, CatalogueVariant } from '@/src/lib/db/rateCatalogue';

export interface RateCatalogueRepository {
  listVariants(projectId: string): Promise<CatalogueVariant[]>;
  listItems(projectId: string): Promise<CatalogueItem[]>;
  listRates(projectId: string): Promise<CatalogueRate[]>;
  addVariants(projectId: string, names: string[]): Promise<number>;
  upsertItem(projectId: string, input: CatalogueItemInput): Promise<{ itemId: string; created: boolean; ratesAdded: number }>;
  priceBoqLine(boqItemId: string, catalogueItemId: string, variantId: string, asOf: string): Promise<number>;
}
