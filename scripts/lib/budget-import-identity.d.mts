export interface BudgetImportIdentityInput {
  projectUuid: string; project: string; category: string; rawCategory: string;
  description: string; fiscalYear: string; amountText: string; amount: number; reference: string;
}
export function encodeBudgetImportIdentity(input: BudgetImportIdentityInput): {
  v2Key: string; legacyKey: string; hasReference: boolean; decimalAmount: string;
};

export function computeBudgetLineImportKey(cells: { project: string; category: string; description: string; fiscalYear: string; amount: string; reference: string }): string;
