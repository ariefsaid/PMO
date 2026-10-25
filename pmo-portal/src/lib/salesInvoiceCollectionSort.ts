export type SalesInvoiceCollectionSort = 'due-asc' | 'overdue-desc' | 'invoice-date-desc';

type SortableInvoice = {
  id: string;
  dueDate: string | null;
  invoiceDate: string | null;
};

function compareKnownDatesFirst(left: string | null, right: string | null, direction: 'asc' | 'desc'): number {
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return direction === 'asc' ? left.localeCompare(right) : right.localeCompare(left);
}

/** Sorts invoice rows without mutating the query result; unknown dates always remain last. */
export function sortSalesInvoiceCollection<T extends SortableInvoice>(
  rows: readonly T[],
  sort: SalesInvoiceCollectionSort,
  today: string,
): T[] {
  return [...rows].sort((left, right) => {
    const dateOrder = sort === 'invoice-date-desc'
      ? compareKnownDatesFirst(left.invoiceDate, right.invoiceDate, 'desc')
      : sort === 'overdue-desc'
        ? compareOverdue(left.dueDate, right.dueDate, today)
        : compareKnownDatesFirst(left.dueDate, right.dueDate, 'asc');

    return dateOrder || left.id.localeCompare(right.id);
  });
}

function compareOverdue(left: string | null, right: string | null, today: string): number {
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;

  const leftIsOverdue = left < today;
  const rightIsOverdue = right < today;
  if (leftIsOverdue !== rightIsOverdue) return leftIsOverdue ? -1 : 1;
  return left.localeCompare(right);
}
