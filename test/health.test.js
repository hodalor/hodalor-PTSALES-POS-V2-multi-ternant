import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

let app;

describe('GET /health', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = ' ';
    ({ app } = await import('../src/server.js'));
  }, 30000);

  it('returns healthy status when the database is not configured', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      name: 'ptsales-backend',
      dbConfigured: false,
      dbConnected: false
    });
    expect(Array.isArray(response.body.dbStates)).toBe(true);
    expect(typeof response.body.uptimeSeconds).toBe('number');
  });
});
