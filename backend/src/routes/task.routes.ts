import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  validateBody,
  validateQuery,
  validateObjectId,
} from '../middleware/validate.middleware';
import {
  createTaskSchema,
  updateTaskSchema,
  completeTaskSchema,
  taskQuerySchema,
} from '../schemas/task.schema';
import {
  createTaskHandler,
  listTasksHandler,
  getTaskByIdHandler,
  updateTaskHandler,
  completeTaskHandler,
  deleteTaskHandler,
} from '../controllers/task.controller';

const router = Router();

// All task routes require authentication
router.use(authenticate);

router.post('/', validateBody(createTaskSchema), createTaskHandler);
router.get('/', validateQuery(taskQuerySchema), listTasksHandler);
router.get('/:id', validateObjectId('id'), getTaskByIdHandler);
router.patch('/:id', validateObjectId('id'), validateBody(updateTaskSchema), updateTaskHandler);
router.put('/:id/completion', validateObjectId('id'), validateBody(completeTaskSchema), completeTaskHandler);
router.delete('/:id', validateObjectId('id'), deleteTaskHandler);

export default router;
