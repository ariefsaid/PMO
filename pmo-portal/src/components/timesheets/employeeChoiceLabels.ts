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

  return normalized.map(({ value, name, email }) => {
    const duplicateName = name && (nameCounts.get(name.toLocaleLowerCase()) ?? 0) > 1;
    return {
      value,
      label: name
        ? duplicateName && email ? `${name} · ${email}` : name
        : email,
      email: email || undefined,
    };
  });
}
