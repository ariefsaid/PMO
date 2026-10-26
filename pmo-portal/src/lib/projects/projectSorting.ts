export const PROJECT_SORTS = ['attention', 'expected-end', 'name'] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];

export const DEFAULT_PROJECT_SORT: ProjectSort = 'attention';

type ProjectSortRow = {
  id: string;
  name: string;
  end_date?: string | null;
};

function normalizedName(name: string): string {
  return name.normalize('NFC').toLocaleLowerCase();
}

function validExpectedEnd(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(timestamp) ? null : value;
}

function compareExpectedEnd<T extends ProjectSortRow>(a: T, b: T): number {
  const aDate = validExpectedEnd(a.end_date);
  const bDate = validExpectedEnd(b.end_date);
  if (aDate === null && bDate !== null) return 1;
  if (aDate !== null && bDate === null) return -1;
  if (aDate !== null && bDate !== null && aDate !== bDate) return aDate < bDate ? -1 : 1;
  return 0;
}

function compareNameAndId<T extends ProjectSortRow>(a: T, b: T): number {
  const aName = normalizedName(a.name);
  const bName = normalizedName(b.name);
  if (aName !== bName) return aName < bName ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/** Sorts a filtered Projects collection consistently across every view. */
export function sortProjectRows<T extends ProjectSortRow>(
  rows: readonly T[],
  sort: ProjectSort,
  isConfirmedRisk: (row: T) => boolean,
): T[] {
  return [...rows].sort((a, b) => {
    if (sort === 'attention') {
      const riskOrder = Number(isConfirmedRisk(b)) - Number(isConfirmedRisk(a));
      if (riskOrder !== 0) return riskOrder;
    }
    if (sort !== 'name') {
      const dateOrder = compareExpectedEnd(a, b);
      if (dateOrder !== 0) return dateOrder;
    }
    return compareNameAndId(a, b);
  });
}
