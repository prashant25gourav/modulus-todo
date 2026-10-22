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

  describe('Worked Table Unit Tests (calculateUrgencyScore)', () => {
    it('high overdue 1h: 30010.00', () => {
      const score = calculateUrgencyScore(
        {
          scheduledAt: new Date(fixedNow.getTime() - 10 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() - 1 * 3600 * 1000),
          priority: 'high',
          completed: false,
        },
        fixedNow
      );
      expect(score).toBeCloseTo(30010, 2);
    });

    it('low overdue 1000h (capped at 336h bonus): 13360.00', () => {
      const score = calculateUrgencyScore(
        {
          scheduledAt: new Date(fixedNow.getTime() - 1010 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() - 1000 * 3600 * 1000),
          priority: 'low',
          completed: false,
        },
        fixedNow
      );
      expect(score).toBeCloseTo(13360, 2);
    });

    it('high overdue 336h exactly at cap boundary: 33360.00', () => {
      const score = calculateUrgencyScore(
        {
          scheduledAt: new Date(fixedNow.getTime() - 350 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() - 336 * 3600 * 1000),
          priority: 'high',
          completed: false,
        },
        fixedNow
      );
      expect(score).toBeCloseTo(33360, 2);
    });

    it('high overdue 500h beyond 336h cap: 33360.00', () => {
      const score = calculateUrgencyScore(
        {
          scheduledAt: new Date(fixedNow.getTime() - 550 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() - 500 * 3600 * 1000),
          priority: 'high',
          completed: false,
        },
        fixedNow
      );
      expect(score).toBeCloseTo(33360, 2);
    });

    it('high due in 2h (started): 1000.00', () => {
      const score = calculateUrgencyScore(
        {
          scheduledAt: new Date(fixedNow.getTime() - 2 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() + 2 * 3600 * 1000),
          priority: 'high',
          completed: false,
        },
        fixedNow
      );
      expect(score).toBeCloseTo(1000, 2);
    });

    it('medium due in 2h (started): 666.67', () => {
      const score = calculateUrgencyScore(
        {
          scheduledAt: new Date(fixedNow.getTime() - 2 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() + 2 * 3600 * 1000),
          priority: 'medium',
          completed: false,
        },
        fixedNow
      );
      expect(score).toBeCloseTo(666.67, 2);
    });

    it('high not yet started due in 2h (damped 0.5): 500.00', () => {
      const score = calculateUrgencyScore(
        {
          scheduledAt: new Date(fixedNow.getTime() + 1 * 3600 * 1000), // starts in 1h
          deadline: new Date(fixedNow.getTime() + 2 * 3600 * 1000),    // due in 2h
          priority: 'high',
          completed: false,
        },
        fixedNow
      );
      expect(score).toBeCloseTo(500, 2);
    });

    it('low due in 2h (started): 333.33', () => {
      const score = calculateUrgencyScore(
        {
          scheduledAt: new Date(fixedNow.getTime() - 2 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() + 2 * 3600 * 1000),
          priority: 'low',
          completed: false,
        },
        fixedNow
      );
      expect(score).toBeCloseTo(333.33, 2);
    });

    it('high due in 1 week (168h): 17.75', () => {
      const score = calculateUrgencyScore(
        {
          scheduledAt: new Date(fixedNow.getTime() - 2 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() + 168 * 3600 * 1000),
          priority: 'high',
          completed: false,
        },
        fixedNow
      );
      expect(score).toBeCloseTo(17.75, 2);
    });

    it('completed task: -1.00', () => {
      const score = calculateUrgencyScore(
        {
          scheduledAt: new Date(fixedNow.getTime() - 24 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() - 12 * 3600 * 1000),
          priority: 'high',
          completed: true,
        },
        fixedNow
      );
      expect(score).toBe(-1);
    });
  });

  describe('Parity Test: Pure Function vs MongoDB Aggregation Pipeline', () => {
    it('should compute mathematically identical scores and exact ordering between JS and MongoDB aggregation', async () => {
      const userId = new mongoose.Types.ObjectId();

      const sampleTasks: (UrgencyTaskInput & { title: string; scheduledAt: Date; deadline: Date })[] = [
        {
          title: 'High overdue 1h',
          priority: 'high',
          scheduledAt: new Date(fixedNow.getTime() - 10 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() - 1 * 3600 * 1000),
          completed: false,
        },
        {
          title: 'Low overdue 1000h (336h cap)',
          priority: 'low',
          scheduledAt: new Date(fixedNow.getTime() - 1010 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() - 1000 * 3600 * 1000),
          completed: false,
        },
        {
          title: 'High overdue 336h (exact cap)',
          priority: 'high',
          scheduledAt: new Date(fixedNow.getTime() - 350 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() - 336 * 3600 * 1000),
          completed: false,
        },
        {
          title: 'High overdue 500h (past cap)',
          priority: 'high',
          scheduledAt: new Date(fixedNow.getTime() - 550 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() - 500 * 3600 * 1000),
          completed: false,
        },
        {
          title: 'High due in 2h',
          priority: 'high',
          scheduledAt: new Date(fixedNow.getTime() - 2 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() + 2 * 3600 * 1000),
          completed: false,
        },
        {
          title: 'Medium due in 2h',
          priority: 'medium',
          scheduledAt: new Date(fixedNow.getTime() - 2 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() + 2 * 3600 * 1000),
          completed: false,
        },
        {
          title: 'High not yet started due in 2h',
          priority: 'high',
          scheduledAt: new Date(fixedNow.getTime() + 1 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() + 2 * 3600 * 1000),
          completed: false,
        },
        {
          title: 'Low due in 2h',
          priority: 'low',
          scheduledAt: new Date(fixedNow.getTime() - 2 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() + 2 * 3600 * 1000),
          completed: false,
        },
        {
          title: 'High due in 1 week',
          priority: 'high',
          scheduledAt: new Date(fixedNow.getTime() - 2 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() + 168 * 3600 * 1000),
          completed: false,
        },
        {
          title: 'Completed High Task',
          priority: 'high',
          scheduledAt: new Date(fixedNow.getTime() - 24 * 3600 * 1000),
          deadline: new Date(fixedNow.getTime() - 12 * 3600 * 1000),
          completed: true,
        },
      ];

      const createdDocs = [];
      for (const t of sampleTasks) {
        const doc = await Task.create({
          userId,
          title: t.title,
          scheduledAt: t.scheduledAt,
          deadline: t.deadline,
          priority: t.priority,
          completed: t.completed,
          completedAt: t.completed ? new Date(fixedNow.getTime() - 12 * 3600 * 1000) : null,
        });
        createdDocs.push(doc);
      }

      // Run MongoDB aggregation pipeline with injected fixedNow
      const pipeline = [
        { $match: { userId } },
        ...buildUrgencyAggregationStages(fixedNow),
      ];

      const aggResults = await Task.aggregate(pipeline);
      expect(aggResults).toHaveLength(sampleTasks.length);

      // Verify each task score matches calculateUrgencyScore with toBeCloseTo
      for (const doc of aggResults) {
        const expectedScore = calculateUrgencyScore(
          {
            scheduledAt: doc.scheduledAt,
            deadline: doc.deadline,
            priority: doc.priority,
            completed: doc.completed,
          },
          fixedNow
        );

        expect(doc.urgencyScore).toBeCloseTo(expectedScore, 2);
      }

      // Compute expected sorted order via pure function with _id: -1 tie-breaker
      const expectedOrder = createdDocs
        .map((t) => ({
          _id: t._id,
          title: t.title,
          score: calculateUrgencyScore(
            {
              scheduledAt: t.scheduledAt,
              deadline: t.deadline,
              priority: t.priority,
              completed: t.completed,
            },
            fixedNow
          ),
        }))
        .sort((a, b) => b.score - a.score || b._id.toString().localeCompare(a._id.toString()));

      expect(aggResults.map((r) => r.title)).toEqual(expectedOrder.map((e) => e.title));
      // Verify exact relative orderings between JS and MongoDB aggregation
      for (let i = 0; i < aggResults.length - 1; i++) {
        expect(aggResults[i].urgencyScore).toBeGreaterThanOrEqual(aggResults[i + 1].urgencyScore);
      }

      // High overdue 500h and 336h are tied at 33360
      expect(aggResults[0].urgencyScore).toBeCloseTo(33360, 2);
      expect(aggResults[1].urgencyScore).toBeCloseTo(33360, 2);

      // High overdue 1h is 30010
      expect(aggResults[2].title).toBe('High overdue 1h');
      expect(aggResults[2].urgencyScore).toBeCloseTo(30010, 2);

      // Low overdue 1000h (capped at 336h bonus) is 13360
      expect(aggResults[3].title).toBe('Low overdue 1000h (336h cap)');
      expect(aggResults[3].urgencyScore).toBeCloseTo(13360, 2);

      // Completed is at the very bottom with -1
      expect(aggResults[aggResults.length - 1].urgencyScore).toBe(-1);
      expect(aggResults[aggResults.length - 1].completed).toBe(true);
    });
  });
});
