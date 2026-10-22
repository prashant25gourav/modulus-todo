import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { connectDB, disconnectDB } from '../src/config/db';
import { User } from '../src/models/user.model';
import { Task } from '../src/models/task.model';
import { issueTokenPair } from '../src/services/token.service';

describe('Task API Integration Suite', () => {
  let mongoServer: MongoMemoryServer;
  let user1Token: string;
  let user1Id: mongoose.Types.ObjectId;
  let user2Id: mongoose.Types.ObjectId;

  const fixedNow = new Date('2026-10-22T12:00:00.000Z');

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDB(mongoServer.getUri());

    const u1 = await User.create({ email: 'user1@example.com', passwordHash: 'hash1' });
    const u2 = await User.create({ email: 'user2@example.com', passwordHash: 'hash2' });
    user1Id = u1._id;
    user2Id = u2._id;

    const p1 = await issueTokenPair(user1Id);
    await issueTokenPair(user2Id);
    user1Token = p1.accessToken;
  });

  afterAll(async () => {
    await disconnectDB();
    await mongoServer.stop();
  });

  afterEach(async () => {
    await Task.deleteMany({});
  });

  describe('Task Creation & Validation', () => {
    it('should create a task with 201 and return { task } without status', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          title: 'Complete Milestone 4',
          description: 'Build robust Task API',
          scheduledAt: '2026-10-22T10:00:00.000Z',
          deadline: '2026-10-22T18:00:00.000Z',
          priority: 'high',
          tags: ['backend', 'Express', 'BACKEND'], // Deduplicated and lowercased
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBeUndefined();
      expect(res.body.task).toBeDefined();
      expect(res.body.task.id).toBeDefined();
      expect(res.body.task.title).toBe('Complete Milestone 4');
      expect(res.body.task.tags).toEqual(['backend', 'express']);
      expect(res.body.task.completed).toBe(false);
      expect(res.body.task.completedAt).toBeNull();
    });

    it('should reject creation when deadline is before scheduledAt with 400', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          title: 'Invalid Date Task',
          scheduledAt: '2026-10-22T18:00:00.000Z',
          deadline: '2026-10-22T10:00:00.000Z',
        });

      expect(res.status).toBe(400);
      expect(res.body.status).toBe('error');
      expect(res.body.message).toBe('Validation failed');
    });

    it('should reject creation when title is empty or exceeds 120 characters', async () => {
      const emptyRes = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          title: '',
          scheduledAt: '2026-10-22T10:00:00.000Z',
          deadline: '2026-10-22T18:00:00.000Z',
        });
      expect(emptyRes.status).toBe(400);

      const longRes = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          title: 'a'.repeat(121),
          scheduledAt: '2026-10-22T10:00:00.000Z',
          deadline: '2026-10-22T18:00:00.000Z',
        });
      expect(longRes.status).toBe(400);
    });
  });

  describe('Update & Atomic Single-Date Checks', () => {
    it('should reject empty {} PATCH with 400', async () => {
      const task = await Task.create({
        userId: user1Id,
        title: 'Original Task',
        scheduledAt: new Date(fixedNow.getTime() - 3600000),
        deadline: new Date(fixedNow.getTime() + 3600000),
        priority: 'medium',
      });

      const res = await request(app)
        .patch(`/api/tasks/${task._id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.status).toBe('error');
      expect(res.body.message).toBe('Validation failed');
    });

    it('should update fields and return { task } without status', async () => {
      const task = await Task.create({
        userId: user1Id,
        title: 'Original Title',
        scheduledAt: new Date(fixedNow.getTime() - 3600000),
        deadline: new Date(fixedNow.getTime() + 3600000),
        priority: 'medium',
      });

      const res = await request(app)
        .patch(`/api/tasks/${task._id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ title: 'Updated Title', priority: 'high' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBeUndefined();
      expect(res.body.task.title).toBe('Updated Title');
      expect(res.body.task.priority).toBe('high');
    });

    it('should atomically reject single-date update when deadline < scheduledAt (400 vs 404)', async () => {
      // scheduledAt: 10:00, deadline: 18:00
      const task = await Task.create({
        userId: user1Id,
        title: 'Date Check Task',
        scheduledAt: new Date('2026-10-22T10:00:00.000Z'),
        deadline: new Date('2026-10-22T18:00:00.000Z'),
        priority: 'medium',
      });

      // 1. Update only deadline to 09:00 (< scheduledAt 10:00) -> 400
      const deadlineRes = await request(app)
        .patch(`/api/tasks/${task._id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ deadline: '2026-10-22T09:00:00.000Z' });

      expect(deadlineRes.status).toBe(400);
      expect(deadlineRes.body.message).toBe('deadline must be greater than or equal to scheduledAt');

      // 2. Update only scheduledAt to 19:00 (> deadline 18:00) -> 400
      const schedRes = await request(app)
        .patch(`/api/tasks/${task._id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ scheduledAt: '2026-10-22T19:00:00.000Z' });

      expect(schedRes.status).toBe(400);
      expect(schedRes.body.message).toBe('deadline must be greater than or equal to scheduledAt');

      // 3. Update single-date on non-existent task ID -> 404
      const fakeId = new mongoose.Types.ObjectId();
      const notFoundRes = await request(app)
        .patch(`/api/tasks/${fakeId}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ deadline: '2026-10-22T09:00:00.000Z' });

      expect(notFoundRes.status).toBe(404);
      expect(notFoundRes.body.message).toBe('Task not found');
    });
  });

  describe('Completion Pipeline & Idempotency', () => {
    it('should mark task completed and set completedAt on PUT /completion, advancing updatedAt', async () => {
      const task = await Task.create({
        userId: user1Id,
        title: 'Task To Complete',
        scheduledAt: new Date(fixedNow.getTime() - 7200000),
        deadline: new Date(fixedNow.getTime() + 7200000),
        priority: 'medium',
        completed: false,
      });

      const initialUpdatedAt = task.updatedAt.toISOString();
      await new Promise((r) => setTimeout(r, 20));

      const res = await request(app)
        .put(`/api/tasks/${task._id}/completion`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ completed: true });

      expect(res.status).toBe(200);
      expect(res.body.status).toBeUndefined();
      expect(res.body.task.completed).toBe(true);
      expect(res.body.task.completedAt).not.toBeNull();
      // On real change (false -> true), updatedAt advances
      expect(new Date(res.body.task.updatedAt).getTime()).toBeGreaterThan(new Date(initialUpdatedAt).getTime());
    });

    it('should preserve original completedAt exactly across two re-completing calls, while updatedAt advances', async () => {
      const task = await Task.create({
        userId: user1Id,
        title: 'Idempotency Test Task',
        scheduledAt: new Date('2026-10-21T10:00:00.000Z'),
        deadline: new Date('2026-10-21T18:00:00.000Z'),
        priority: 'high',
        completed: false,
      });

      // Call 1: complete task
      const call1 = await request(app)
        .put(`/api/tasks/${task._id}/completion`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ completed: true });
      expect(call1.status).toBe(200);
      const firstCompletedAt = call1.body.task.completedAt;
      const firstUpdatedAt = call1.body.task.updatedAt;

      await new Promise((r) => setTimeout(r, 20));

      // Call 2: re-complete with true (no-op value change)
      const call2 = await request(app)
        .put(`/api/tasks/${task._id}/completion`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ completed: true });
      expect(call2.status).toBe(200);

      // completedAt is preserved exactly across calls
      expect(call2.body.task.completedAt).toBe(firstCompletedAt);
      // updatedAt advances even on no-op because findOneAndUpdate touches document metadata
      expect(new Date(call2.body.task.updatedAt).getTime()).toBeGreaterThan(new Date(firstUpdatedAt).getTime());

      await new Promise((r) => setTimeout(r, 20));

      // Call 3: re-complete again with true (second no-op)
      const call3 = await request(app)
        .put(`/api/tasks/${task._id}/completion`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ completed: true });
      expect(call3.status).toBe(200);

      // completedAt remains unchanged across all calls
      expect(call3.body.task.completedAt).toBe(firstCompletedAt);
      // updatedAt advances again
      expect(new Date(call3.body.task.updatedAt).getTime()).toBeGreaterThan(new Date(call2.body.task.updatedAt).getTime());
    });

    it('should treat completed:false on an incomplete task as a no-op, preserving null completedAt while advancing updatedAt', async () => {
      const task = await Task.create({
        userId: user1Id,
        title: 'Already Incomplete Task',
        scheduledAt: new Date(fixedNow.getTime() - 7200000),
        deadline: new Date(fixedNow.getTime() + 7200000),
        priority: 'medium',
        completed: false,
        completedAt: null,
      });

      const initialUpdatedAt = task.updatedAt.toISOString();
      await new Promise((r) => setTimeout(r, 20));

      // Send completed: false on already incomplete task
      const res = await request(app)
        .put(`/api/tasks/${task._id}/completion`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ completed: false });

      expect(res.status).toBe(200);
      expect(res.body.task.completed).toBe(false);
      expect(res.body.task.completedAt).toBeNull();
      // On no-op (false -> false), updatedAt still advances due to document write
      expect(new Date(res.body.task.updatedAt).getTime()).toBeGreaterThan(new Date(initialUpdatedAt).getTime());
    });

    it('should clear completedAt when transitioning from completed: true to completed: false', async () => {
      const task = await Task.create({
        userId: user1Id,
        title: 'Transition To Incomplete Task',
        scheduledAt: new Date(fixedNow.getTime() - 7200000),
        deadline: new Date(fixedNow.getTime() + 7200000),
        priority: 'medium',
        completed: true,
        completedAt: new Date(),
      });

      const res = await request(app)
        .put(`/api/tasks/${task._id}/completion`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ completed: false });

      expect(res.status).toBe(200);
      expect(res.body.task.completed).toBe(false);
      expect(res.body.task.completedAt).toBeNull();
    });
  });

  describe('Deletion & 204 Status', () => {
    it('should delete task with 204 No Content', async () => {
      const task = await Task.create({
        userId: user1Id,
        title: 'Task To Delete',
        scheduledAt: new Date(),
        deadline: new Date(Date.now() + 3600000),
        priority: 'low',
      });

      const res = await request(app)
        .delete(`/api/tasks/${task._id}`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});

      // Subsequent get returns 404
      const getRes = await request(app)
        .get(`/api/tasks/${task._id}`)
        .set('Authorization', `Bearer ${user1Token}`);
      expect(getRes.status).toBe(404);
    });
  });

  describe('Search Metacharacters Literal Matching', () => {
    it('should match regex metacharacters .*, ( and [ literally', async () => {
      await Task.create({
        userId: user1Id,
        title: 'Special Task with .* regex characters',
        scheduledAt: new Date(),
        deadline: new Date(Date.now() + 3600000),
        priority: 'medium',
      });
      await Task.create({
        userId: user1Id,
        title: 'Special Task with (parentheses) included',
        scheduledAt: new Date(),
        deadline: new Date(Date.now() + 3600000),
        priority: 'medium',
      });
      await Task.create({
        userId: user1Id,
        title: 'Special Task with [brackets] included',
        scheduledAt: new Date(),
        deadline: new Date(Date.now() + 3600000),
        priority: 'medium',
      });
      await Task.create({
        userId: user1Id,
        title: 'Regular Ordinary Task',
        scheduledAt: new Date(),
        deadline: new Date(Date.now() + 3600000),
        priority: 'low',
      });

      // 1. Search for .*
      const resDotStar = await request(app)
        .get('/api/tasks?search=.*')
        .set('Authorization', `Bearer ${user1Token}`);
      expect(resDotStar.status).toBe(200);
      expect(resDotStar.body.tasks).toHaveLength(1);
      expect(resDotStar.body.tasks[0].title).toContain('.*');

      // 2. Search for (
      const resParen = await request(app)
        .get('/api/tasks?search=(')
        .set('Authorization', `Bearer ${user1Token}`);
      expect(resParen.status).toBe(200);
      expect(resParen.body.tasks).toHaveLength(1);
      expect(resParen.body.tasks[0].title).toContain('(parentheses)');

      // 3. Search for [
      const resBracket = await request(app)
        .get('/api/tasks?search=[')
        .set('Authorization', `Bearer ${user1Token}`);
      expect(resBracket.status).toBe(200);
      expect(resBracket.body.tasks).toHaveLength(1);
      expect(resBracket.body.tasks[0].title).toContain('[brackets]');
    });
  });

  describe('Sorting & Tie-Stable Pagination', () => {
    it('should sort by priority both ways with $switch rank (desc: high, medium, low)', async () => {
      await Task.create({
        userId: user1Id,
        title: 'Low Task',
        scheduledAt: new Date(),
        deadline: new Date(Date.now() + 3600000),
        priority: 'low',
      });
      await Task.create({
        userId: user1Id,
        title: 'Medium Task',
        scheduledAt: new Date(),
        deadline: new Date(Date.now() + 3600000),
        priority: 'medium',
      });
      await Task.create({
        userId: user1Id,
        title: 'High Task',
        scheduledAt: new Date(),
        deadline: new Date(Date.now() + 3600000),
        priority: 'high',
      });

      // Descending: high, medium, low
      const descRes = await request(app)
        .get('/api/tasks?sortBy=priority&sortOrder=desc')
        .set('Authorization', `Bearer ${user1Token}`);
      expect(descRes.status).toBe(200);
      expect(descRes.body.tasks.map((t: any) => t.priority)).toEqual(['high', 'medium', 'low']);

      // Ascending: low, medium, high
      const ascRes = await request(app)
        .get('/api/tasks?sortBy=priority&sortOrder=asc')
        .set('Authorization', `Bearer ${user1Token}`);
      expect(ascRes.status).toBe(200);
      expect(ascRes.body.tasks.map((t: any) => t.priority)).toEqual(['low', 'medium', 'high']);
    });

    it('should provide tie-stable pagination across pages for identical sort values', async () => {
      const fixedDate = new Date('2026-10-22T10:00:00.000Z');
      const taskIds: string[] = [];

      for (let i = 1; i <= 5; i++) {
        const t = await Task.create({
          userId: user1Id,
          title: `Tied Task ${i}`,
          scheduledAt: fixedDate,
          deadline: fixedDate,
          priority: 'medium',
        });
        taskIds.push(t._id.toString());
      }

      // Page 1 (limit 2)
      const p1 = await request(app)
        .get('/api/tasks?sortBy=deadline&sortOrder=desc&page=1&limit=2')
        .set('Authorization', `Bearer ${user1Token}`);
      expect(p1.body.tasks).toHaveLength(2);

      // Page 2 (limit 2)
      const p2 = await request(app)
        .get('/api/tasks?sortBy=deadline&sortOrder=desc&page=2&limit=2')
        .set('Authorization', `Bearer ${user1Token}`);
      expect(p2.body.tasks).toHaveLength(2);

      // Page 3 (limit 2)
      const p3 = await request(app)
        .get('/api/tasks?sortBy=deadline&sortOrder=desc&page=3&limit=2')
        .set('Authorization', `Bearer ${user1Token}`);
      expect(p3.body.tasks).toHaveLength(1);

      const allFetchedIds = [
        ...p1.body.tasks.map((t: any) => t.id),
        ...p2.body.tasks.map((t: any) => t.id),
        ...p3.body.tasks.map((t: any) => t.id),
      ];

      // No duplicates across pages and all 5 tasks retrieved
      expect(new Set(allFetchedIds).size).toBe(5);
    });

    it('should verify urgencyScore does not leak into JSON results on sortBy=urgency', async () => {
      await Task.create({
        userId: user1Id,
        title: 'Urgent Task',
        scheduledAt: new Date(fixedNow.getTime() - 3600000),
        deadline: new Date(fixedNow.getTime() + 3600000),
        priority: 'high',
      });

      const res = await request(app)
        .get('/api/tasks?sortBy=urgency')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.tasks).toHaveLength(1);
      expect(res.body.tasks[0].urgencyScore).toBeUndefined();
    });
  });

  describe('Isolation & Cross-User Security', () => {
    it('should never include another user tasks in list, search, or filters', async () => {
      // User 1 tasks
      await Task.create({
        userId: user1Id,
        title: 'User 1 Confidential Task',
        description: 'Secret planning',
        scheduledAt: new Date(),
        deadline: new Date(Date.now() + 3600000),
        priority: 'high',
        tags: ['confidential'],
      });

      // User 2 tasks
      await Task.create({
        userId: user2Id,
        title: 'User 2 Confidential Task',
        description: 'Secret planning',
        scheduledAt: new Date(),
        deadline: new Date(Date.now() + 3600000),
        priority: 'high',
        tags: ['confidential'],
      });

      // Search by user 1
      const searchRes = await request(app)
        .get('/api/tasks?search=Confidential')
        .set('Authorization', `Bearer ${user1Token}`);
      expect(searchRes.status).toBe(200);
      expect(searchRes.body.tasks).toHaveLength(1);
      expect(searchRes.body.tasks[0].title).toBe('User 1 Confidential Task');

      // Tag filter by user 1
      const tagRes = await request(app)
        .get('/api/tasks?tag=confidential')
        .set('Authorization', `Bearer ${user1Token}`);
      expect(tagRes.status).toBe(200);
      expect(tagRes.body.tasks).toHaveLength(1);
      expect(tagRes.body.tasks[0].title).toBe('User 1 Confidential Task');
    });

    it('should return 404 on cross-user read, update, delete, and completion', async () => {
      const u2Task = await Task.create({
        userId: user2Id,
        title: 'User 2 Task',
        scheduledAt: new Date(),
        deadline: new Date(Date.now() + 3600000),
        priority: 'medium',
      });

      // 1. Cross-user GET
      const getRes = await request(app)
        .get(`/api/tasks/${u2Task._id}`)
        .set('Authorization', `Bearer ${user1Token}`);
      expect(getRes.status).toBe(404);
      expect(getRes.body.message).toBe('Task not found');

      // 2. Cross-user PATCH
      const patchRes = await request(app)
        .patch(`/api/tasks/${u2Task._id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ title: 'Hacked Title' });
      expect(patchRes.status).toBe(404);
      expect(patchRes.body.message).toBe('Task not found');

      // 3. Cross-user PUT completion
      const compRes = await request(app)
        .put(`/api/tasks/${u2Task._id}/completion`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ completed: true });
      expect(compRes.status).toBe(404);
      expect(compRes.body.message).toBe('Task not found');

      // 4. Cross-user DELETE
      const delRes = await request(app)
        .delete(`/api/tasks/${u2Task._id}`)
        .set('Authorization', `Bearer ${user1Token}`);
      expect(delRes.status).toBe(404);
      expect(delRes.body.message).toBe('Task not found');
    });

    it('should return 400 on invalid 24-hex ObjectId', async () => {
      const res = await request(app)
        .get('/api/tasks/not-a-valid-id')
        .set('Authorization', `Bearer ${user1Token}`);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid task ID');
    });
  });
});
