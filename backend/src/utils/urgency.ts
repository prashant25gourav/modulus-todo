import { TaskPriority } from '../models/task.model';

export interface UrgencyTaskInput {
  deadline: Date | string;
  priority: TaskPriority;
  completed: boolean;
}

export const PRIORITY_WEIGHTS: Record<TaskPriority, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * Pure function to calculate task urgency score mixing time-to-deadline and priority.
 * Injected with 'now' (default: new Date()) for deterministic calculation and parity testing.
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
    // Overdue: base score of 10000 ensures overdue tasks always score higher than future tasks.
    // Score increases with hours overdue and priority weight.
    const overdueHours = Math.abs(diffHours);
    return 10000 + overdueHours * 10 * weight;
  }

  // Upcoming: hyperbolic scaling as deadline approaches, scaled by priority weight.
  return (1000 / (diffHours + 1)) * weight;
};

/**
 * Builds the MongoDB aggregation pipeline stages calculating the identical urgencyScore
 * and sorting by urgencyScore descending with an _id tie-breaker.
 * Injected with 'now' (default: new Date()) for parity testing with calculateUrgencyScore.
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
                },
                in: {
                  $cond: {
                    if: { $lt: ['$$diffHours', 0] },
                    then: {
                      $add: [
                        10000,
                        {
                          $multiply: [
                            { $abs: '$$diffHours' },
                            10,
                            '$$weight',
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
