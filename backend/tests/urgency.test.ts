import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDB, disconnectDB } from '../src/config/db';
import { Task } from '../src/models/task.model';
import { calculateUrgencyScore, buildUrgencyAggregationStages, UrgencyTaskInput } from '../src/utils/urgency';

describe('Urgency Scoring & Pipeline Parity', () => {
  let mongoServer: MongoMemoryServer;
  const fixedNow = new Date('2026-10-22T10:00:00.000Z');

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDB(mongoServer.getUri());
  });

  afterAll(async () => {
    await disconnectDB();
    await mongoServer.stop();
  });

  afterEach(async () => {
    await Task.deleteMany({});
  });

  describe('Pure Function (calculateUrgencyScore)', () => {
    it('should assign -1 to completed tasks regardless of deadline or priority', () => {
      const score = calculateUrgencyScore(
        {
          deadline: '2026-10-22T08:00:00.000Z',
          priority: 'high',
          completed: true,
        },
        fixedNow
      );
      expect(score).toBe(-1);
    });

    it('should scale upcoming tasks with higher priority having higher score for identical deadline', () => {
      const deadline = new Date(fixedNow.getTime() + 5 * 3600 * 1000); // 5 hours in future
      const low = calculateUrgencyScore({ deadline, priority: 'low', completed: false }, fixedNow);
      const med = calculateUrgencyScore({ deadline, priority: 'medium', completed: false }, fixedNow);
      const high = calculateUrgencyScore({ deadline, priority: 'high', completed: false }, fixedNow);

      expect(high).toBeGreaterThan(med);
      expect(med).toBeGreaterThan(low);
      expect(high).toBeLessThan(10000);
    });

    it('should score closer deadlines higher for identical priority', () => {
      const dueIn1Hour = new Date(fixedNow.getTime() + 1 * 3600 * 1000);
      const dueIn10Hours = new Date(fixedNow.getTime() + 10 * 3600 * 1000);

      const nearScore = calculateUrgencyScore({ deadline: dueIn1Hour, priority: 'high', completed: false }, fixedNow);
      const farScore = calculateUrgencyScore({ deadline: dueIn10Hours, priority: 'high', completed: false }, fixedNow);

      expect(nearScore).toBeGreaterThan(farScore);
    });

    it('should score overdue tasks above 10000, higher than any future task', () => {
      const overdueDeadline = new Date(fixedNow.getTime() - 1 * 3600 * 1000); // 1 hour overdue
      const impendingDeadline = new Date(fixedNow.getTime() + 1000); // due in 1 second

      const overdueScore = calculateUrgencyScore({ deadline: overdueDeadline, priority: 'low', completed: false }, fixedNow);
      const impendingScore = calculateUrgencyScore({ deadline: impendingDeadline, priority: 'high', completed: false }, fixedNow);

      expect(overdueScore).toBeGreaterThanOrEqual(10000);
      expect(overdueScore).toBeGreaterThan(impendingScore);
    });

    it('should increase score as overdue duration increases', () => {
      const overdue1h = new Date(fixedNow.getTime() - 1 * 3600 * 1000);
      const overdue10h = new Date(fixedNow.getTime() - 10 * 3600 * 1000);

      const score1h = calculateUrgencyScore({ deadline: overdue1h, priority: 'high', completed: false }, fixedNow);
      const score10h = calculateUrgencyScore({ deadline: overdue10h, priority: 'high', completed: false }, fixedNow);

      expect(score10h).toBeGreaterThan(score1h);
    });
  });

  describe('Parity Test: Pure Function vs MongoDB Aggregation Pipeline', () => {
    it('should compute mathematically identical scores and ordering between JS and MongoDB aggregation', async () => {
      const userId = new mongoose.Types.ObjectId();

      const sampleTasks: (UrgencyTaskInput & { title: string; scheduledAt: Date })[] = [
        // Completed
        {
          title: 'Completed Task',
          scheduledAt: new Date(fixedNow.getTime() - 48 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() - 24 * 3600 * 1000),
          priority: 'high',
          completed: true,
        },
        // Overdue High
        {
          title: 'Overdue High Priority',
          scheduledAt: new Date(fixedNow.getTime() - 20 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() - 5 * 3600 * 1000),
          priority: 'high',
          completed: false,
        },
        // Overdue Low
        {
          title: 'Overdue Low Priority',
          scheduledAt: new Date(fixedNow.getTime() - 20 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() - 2 * 3600 * 1000),
          priority: 'low',
          completed: false,
        },
        // Impending High
        {
          title: 'Due In 1 Hour High',
          scheduledAt: new Date(fixedNow.getTime() - 2 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() + 1 * 3600 * 1000),
          priority: 'high',
          completed: false,
        },
        // Due In 1 Hour Medium
        {
          title: 'Due In 1 Hour Medium',
          scheduledAt: new Date(fixedNow.getTime() - 2 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() + 1 * 3600 * 1000),
          priority: 'medium',
          completed: false,
        },
        // Due Far In Future
        {
          title: 'Due In 7 Days Low',
          scheduledAt: new Date(fixedNow.getTime()),
          deadline: new Date(fixedNow.getTime() + 7 * 24 * 3600 * 1000),
          priority: 'low',
          completed: false,
        },
      ];

      for (const t of sampleTasks) {
        await Task.create({
          userId,
          title: t.title,
          scheduledAt: t.scheduledAt,
          deadline: t.deadline,
          priority: t.priority,
          completed: t.completed,
          completedAt: t.completed ? new Date(fixedNow.getTime() - 24 * 3600 * 1000) : null,
        });
      }

      // Run MongoDB aggregation pipeline with injected fixedNow
      const pipeline = [
        { $match: { userId } },
        ...buildUrgencyAggregationStages(fixedNow),
      ];

      const aggResults = await Task.aggregate(pipeline);
      expect(aggResults).toHaveLength(sampleTasks.length);

      // Verify each item's urgencyScore matches calculateUrgencyScore
      for (const doc of aggResults) {
        const expectedScore = calculateUrgencyScore(
          {
            deadline: doc.deadline,
            priority: doc.priority,
            completed: doc.completed,
          },
          fixedNow
        );

        expect(Math.abs(doc.urgencyScore - expectedScore)).toBeLessThan(0.0001);
      }

      // Verify sorting is descending by urgencyScore
      for (let i = 0; i < aggResults.length - 1; i++) {
        expect(aggResults[i].urgencyScore).toBeGreaterThanOrEqual(aggResults[i + 1].urgencyScore);
      }

      // Assert completed task is at the very end with score -1
      expect(aggResults[aggResults.length - 1].urgencyScore).toBe(-1);
      expect(aggResults[aggResults.length - 1].completed).toBe(true);

      // Assert overdue high task is at the very top
      expect(aggResults[0].title).toBe('Overdue High Priority');
      expect(aggResults[0].urgencyScore).toBeGreaterThan(10000);
    });
  });
});
