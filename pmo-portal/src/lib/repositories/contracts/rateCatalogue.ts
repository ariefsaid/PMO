import type { CatalogueItem, CatalogueItemInput, CatalogueRate, CatalogueVariant } from '@/src/lib/db/rateCatalogue';

export interface RateCatalogueRepository {
  listVariants(projectId: string): Promise<CatalogueVariant[]>;
  listItems(projectId: string): Promise<CatalogueItem[]>;
  listRates(projectId: string): Promise<CatalogueRate[]>;
  addVariants(projectId: string, names: string[]): Promise<number>;
  setDefaultVariant(projectId: string, variantId: string | null): Promise<void>;
  savePricedLine(projectId: string, lineId: string | null, input: { itemCode: string; description: string; unit: string; quantity: number; earningBasis: string; lineNo: number | null }, itemId: string, variantId: string, asOf: string): Promise<string>;
  upsertItem(projectId: string, input: CatalogueItemInput): Promise<{ itemId: string; created: boolean; ratesAdded: number }>;
  priceBoqLine(boqItemId: string, catalogueItemId: string, variantId: string, asOf: string): Promise<number>;
}
