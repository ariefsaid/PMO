import { toAppError } from '@/src/lib/appError';
import {
  existingFxRates,
  fxContext,
  fxRateOn,
  listFxRates,
  upsertFxRates,
} from '@/src/lib/db/fxRates';
import type { FxRatesRepository } from './types';

async function normalized<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw toAppError(error);
  }
}

export const fxRatesRepository: FxRatesRepository = {
  list: (before) => normalized(() => listFxRates(before)),
  existing: (dates) => normalized(() => existingFxRates(dates)),
  onDate: (base, quote, onDate) => normalized(() => fxRateOn(base, quote, onDate)),
  upsert: (rows) => normalized(() => upsertFxRates(rows)),
  context: () => normalized(() => fxContext()),
};
