export interface EmployeeChoiceIdentity {
  value: string;
  name: string | null | undefined;
  email: string | null | undefined;
}

export interface EmployeeChoiceLabel {
  value: string;
  label: string;
  email?: string;
}

/** Formats employee choices consistently, adding email only when it distinguishes duplicate names. */
export function employeeChoiceLabels(
  choices: readonly EmployeeChoiceIdentity[],
  options: { omitAmbiguous?: boolean } = {},
): EmployeeChoiceLabel[] {
  const normalized = choices.map((choice) => ({
    value: choice.value,
    name: choice.name?.trim() ?? '',
    email: choice.email?.trim() ?? '',
  }));
  const nameCounts = new Map<string, number>();
  for (const choice of normalized) {
    if (choice.name) {
      const key = choice.name.toLocaleLowerCase();
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
  }

  const labels = normalized.map(({ value, name, email }) => {
    const duplicateName = name && (nameCounts.get(name.toLocaleLowerCase()) ?? 0) > 1;
    return {
      value,
      label: name
        ? duplicateName && email ? `${name} · ${email}` : name
        : email,
      email: email || undefined,
      duplicateName: Boolean(duplicateName),
      hasEmail: Boolean(email),
    };
  });
  if (!options.omitAmbiguous) return labels.map(({ value, label, email }) => ({ value, label, email }));

  // Drop choices that cannot be told apart first, then de-duplicate labels among the rest only.
  const distinguishable = labels.filter(({ duplicateName, hasEmail }) => !(duplicateName && !hasEmail));
  const labelCounts = new Map<string, number>();
  for (const { label } of distinguishable) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  return distinguishable
    .filter(({ label }) => labelCounts.get(label) === 1)
    .map(({ value, label, email }) => ({ value, label, email }));
}
