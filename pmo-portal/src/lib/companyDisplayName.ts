/** Short names decorate the legal identity; never replace the stored legal name. */
export function companyDisplayName(company: { name: string; short_name?: string | null }): string {
  return company.short_name?.trim() || company.name;
}
