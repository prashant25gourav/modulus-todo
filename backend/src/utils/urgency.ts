import { TaskPriority } from '../models/task.model';

export interface UrgencyTaskInput {
  deadline: Date | string;
  priority: TaskPriority;
  completed: boolean;
  scheduledAt?: Date | string;
}

export const PRIORITY_WEIGHTS: Record<TaskPriority, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * Pure function to calculate task urgency score mixing time-to-deadline, priority, and scheduledAt.
 * Overdue: priority dominates (10000 * weight + min(overdueHours, 336) * 10).
 * Upcoming: hyperbolic scaling with 0.5 damping factor for not-yet-started tasks (now < scheduledAt).
 * Completed: -1.
 */
export const calculateUrgencyScore = (task: UrgencyTaskInput, now: Date = new Date()): number => {
  if (task.completed) {
    return -1;
  }

  const deadlineMs = new Date(task.deadline).getTime();
  const nowMs = now.getTime();
  const diffHours = (deadlineMs - nowMs) / (1000 * 60 * 60);
  const weight = PRIORITY_WEIGHTS[task.priority] || 2;

  if (diffHours < 0) {
    const overdueHours = Math.abs(diffHours);
    const cappedOverdue = Math.min(overdueHours, 336);
    return 10000 * weight + cappedOverdue * 10;
  }

  const isStarted = task.scheduledAt ? nowMs >= new Date(task.scheduledAt).getTime() : true;
  const damping = isStarted ? 1.0 : 0.5;

  return (1000 / (diffHours + 1)) * weight * damping;
};

/**
 * Builds the MongoDB aggregation pipeline stages calculating the identical urgencyScore
 * and sorting by urgencyScore descending with an _id tie-breaker.
 */
export const buildUrgencyAggregationStages = (now: Date = new Date()) => {
  const nowMs = now.getTime();

  return [
    {
      $addFields: {
        urgencyScore: {
          $cond: {
            if: { $eq: ['$completed', true] },
            then: -1,
            else: {
              $let: {
                vars: {
                  diffHours: {
                    $divide: [
                      { $subtract: [{ $toLong: '$deadline' }, nowMs] },
                      1000 * 60 * 60,
                    ],
                  },
                  weight: {
                    $switch: {
                      branches: [
                        { case: { $eq: ['$priority', 'high'] }, then: 3 },
                        { case: { $eq: ['$priority', 'medium'] }, then: 2 },
                        { case: { $eq: ['$priority', 'low'] }, then: 1 },
                      ],
                      default: 2,
                    },
                  },
                  isStarted: {
                    $cond: {
                      if: { $ifNull: ['$scheduledAt', false] },
                      then: { $gte: [nowMs, { $toLong: '$scheduledAt' }] },
                      else: true,
                    },
                  },
                },
                in: {
                  $cond: {
                    if: { $lt: ['$$diffHours', 0] },
                    then: {
                      $add: [
                        { $multiply: [10000, '$$weight'] },
                        {
                          $multiply: [
                            { $min: [{ $abs: '$$diffHours' }, 336] },
                            10,
                          ],
                        },
                      ],
                    },
                    else: {
                      $multiply: [
                        {
                          $divide: [
                            1000,
                            { $add: ['$$diffHours', 1] },
                          ],
                        },
                        '$$weight',
                        {
                          $cond: {
                            if: '$$isStarted',
                            then: 1.0,
                            else: 0.5,
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      $sort: {
        urgencyScore: -1 as const,
        _id: -1 as const,
      },
    },
  ];
};
