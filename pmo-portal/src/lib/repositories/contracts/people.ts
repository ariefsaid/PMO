/** People register repository contract (#2542 follow-up). One-to-one with the DAL. */
import type * as dal from '@/src/lib/db/people';

export interface PeopleRepository {
  list: typeof dal.listPeople;
  create: typeof dal.createPerson;
  update: typeof dal.updatePerson;
  updateFields: typeof dal.updatePersonFields;
  archive: typeof dal.archivePerson;
}
