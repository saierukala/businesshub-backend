import { Router } from 'express';
import * as c from '../controllers/technician.controller';
import * as s from './technicians.schemas';
import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';

// Owner and Manager set up technicians. A technician's own schedule view comes with visits.
export const techniciansRouter = Router();
techniciansRouter.use(requireAuth, requireRole('OWNER', 'MANAGER'));
techniciansRouter.get('/', validate({ query: s.listTechniciansQuery }), c.list);
techniciansRouter.get('/:id', validate({ params: s.techParams }), c.get);
techniciansRouter.put('/:id/skills', validate({ params: s.techParams, body: s.setSkillsBody }), c.setSkills);
techniciansRouter.put('/:id/areas', validate({ params: s.techParams, body: s.setAreasBody }), c.setAreas);
techniciansRouter.put('/:id/working-hours', validate({ params: s.techParams, body: s.setWorkingHoursBody }), c.setWorkingHours);
techniciansRouter.get('/:id/time-off', validate({ params: s.techParams, query: s.listTimeOffQuery }), c.listTimeOff);
techniciansRouter.post('/:id/time-off', validate({ params: s.techParams, body: s.createTimeOffBody }), c.createTimeOff);
techniciansRouter.delete('/:id/time-off/:timeOffId', validate({ params: s.timeOffParams }), c.deleteTimeOff);
