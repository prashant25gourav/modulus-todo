import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
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

router.post('/', createTaskHandler);
router.get('/', listTasksHandler);
router.get('/:id', getTaskByIdHandler);
router.patch('/:id', updateTaskHandler);
router.patch('/:id/complete', completeTaskHandler);
router.delete('/:id', deleteTaskHandler);

export default router;
