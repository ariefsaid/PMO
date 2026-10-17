import { toAppError } from '@/src/lib/appError';
import { getProjectsMoneyCollection, type ProjectMoneyRead } from '@/src/lib/db/projectMoney';

export const projectMoneyRepository = {
  async collection(ids: string[]): Promise<Record<string, ProjectMoneyRead>> {
    try {
      return await getProjectsMoneyCollection(ids);
    } catch (error) {
      throw toAppError(error);
    }
  },
};
