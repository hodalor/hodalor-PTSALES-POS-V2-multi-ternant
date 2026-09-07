import { spawn } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_PORT = 43123;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let serverProcess = null;
let stderrBuffer = '';

function waitForServerReady() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for backend test server. Stderr: ${stderrBuffer}`));
    }, 20000);

    const onStdout = (chunk) => {
      const text = String(chunk || '');
      if (text.includes(`API on ${TEST_PORT}`)) {
        clearTimeout(timeout);
        serverProcess?.stdout?.off('data', onStdout);
        resolve();
      }
    };

    serverProcess?.stdout?.on('data', onStdout);
    serverProcess?.stderr?.on('data', (chunk) => {
      stderrBuffer += String(chunk || '');
    });
    serverProcess?.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Backend test server exited early with code ${code}. Stderr: ${stderrBuffer}`));
    });
  });
}

describe('GET /health', () => {
  beforeAll(async () => {
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(TEST_PORT),
      MONGODB_URI: ''
    };
    serverProcess = spawn(process.execPath, ['src/server.js'], {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    await waitForServerReady();
  }, 30000);

  afterAll(async () => {
    if (!serverProcess || serverProcess.killed) return;
    await new Promise((resolve) => {
      serverProcess.once('exit', () => resolve());
      serverProcess.kill('SIGTERM');
    });
  }, 30000);

  it('returns healthy status when the database is not configured', async () => {
    const response = await request(BASE_URL)
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
