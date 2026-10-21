import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app';

describe('404 Not Found Handler', () => {
  it('should return 404 with JSON error format for unknown routes', async () => {
    const response = await request(app).get('/api/non-existent-route-endpoint');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/json/);
    expect(response.body).toEqual({
      status: 'error',
      message: 'Resource not found',
    });
  });
});
