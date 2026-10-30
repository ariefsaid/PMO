/** The ERP-owned identity fields must not change while an edit form is open. */
export function contactIdentityChanged(
  values: { full_name: string; company_id: string; email: string; phone: string },
  original: { full_name: string; company_id: string; email: string | null; phone: string | null },
): boolean {
  return values.full_name.trim() !== original.full_name.trim()
    || values.company_id !== original.company_id
    || (values.email.trim() || null) !== (original.email?.trim() || null)
    || (values.phone.trim() || null) !== (original.phone?.trim() || null);
}

export function companyIdentityChanged(
  values: { name: string; type: string }, original: { name: string; type: string },
): boolean {
  return values.type !== original.type || (original.type !== 'Internal' && values.name.trim() !== original.name.trim());
}
