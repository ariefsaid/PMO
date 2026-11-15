import { AppError } from '@/src/lib/appError';

/** The Draft was saved and the post did not go through (refused, still settling, or held): the error names the document, so the form opens it instead of creating another. */
export class StockDispatchError extends AppError {
  constructor(cause: AppError, readonly documentId: string) {
    super(cause.message, cause.code, cause.details);
    this.name = 'StockDispatchError';
  }
}
