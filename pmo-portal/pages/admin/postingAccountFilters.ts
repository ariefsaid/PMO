export type PostingAccountPurpose = 'all' | 'budget' | 'expense';
export type PostingAccountCoverage = 'all' | 'configured' | 'needs-setup';
export type PostingAccountSort = 'asc' | 'desc';

export interface PostingAccountFilters {
  purpose: PostingAccountPurpose;
  coverage: PostingAccountCoverage;
  sort: PostingAccountSort;
  search: string;
  onClear: () => void;
}

export const DEFAULT_POSTING_ACCOUNT_FILTERS = {
  purpose: 'all',
  coverage: 'all',
  sort: 'asc',
  search: '',
} as const;
