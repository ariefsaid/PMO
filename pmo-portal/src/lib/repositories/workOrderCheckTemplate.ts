import { listCheckTemplate, saveCheckTemplate } from '@/src/lib/db/workOrderCheckTemplate';
import type { WorkOrderCheckTemplateRepository } from './contracts/workOrderCheckTemplate';

export const workOrderCheckTemplateRepository: WorkOrderCheckTemplateRepository = { list: listCheckTemplate, save: saveCheckTemplate };
