type Translate = (key: string, fallback: string) => string;

/** Static category calls keep every budget label visible to the i18n catalogue gates. */
export function budgetCategoryLabel(category: string, t: Translate): string {
  switch (category) {
    case 'Labor': return t('financeCopy.budgetCategoryLabor', 'Labor');
    case 'Materials': return t('financeCopy.budgetCategoryMaterials', 'Materials');
    case 'Subcontractors': return t('financeCopy.budgetCategorySubcontractors', 'Subcontractors');
    case 'Equipment': return t('financeCopy.budgetCategoryEquipment', 'Equipment');
    case 'Permits & Fees': return t('financeCopy.budgetCategoryPermitsFees', 'Permits & Fees');
    case 'Overheads': return t('financeCopy.budgetCategoryOverheads', 'Overheads');
    case 'Contingency': return t('financeCopy.budgetCategoryContingency', 'Contingency');
    case 'Special expenses': return t('budget.category.specialExpenses', 'Special expenses');
    default: return category;
  }
}
