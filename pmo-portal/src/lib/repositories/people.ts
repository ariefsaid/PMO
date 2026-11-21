/** People register repository (#2542 follow-up, ADR-0017): the API seam over the DAL. */
import * as dal from '@/src/lib/db/people';
import { wrap } from './repositoryErrors';
import type { PeopleRepository } from './contracts/people';

export const peopleRepository: PeopleRepository = {
  list: (status) => wrap(() => dal.listPeople(status)),
  create: (input) => wrap(() => dal.createPerson(input)),
  update: (id, input) => wrap(() => dal.updatePerson(id, input)),
  archive: (id) => wrap(() => dal.archivePerson(id)),
};
