import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { hashPassword, hashToken, verifyPassword } from '../src/security.js';

test('password hashes are salted and checked safely', async () => {
  const first = await hashPassword('sample-password');
  const second = await hashPassword('sample-password');
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('sample-password', first), true);
  assert.equal(await verifyPassword('wrong-password', first), false);
});

test('session tokens are hashed before storage', () => {
  assert.equal(hashToken('token').length, 64);
  assert.notEqual(hashToken('token'), 'token');
});

test('profile routes reject requests without an Express session', async () => {
  const database = { query: async () => { throw new Error('Database should not be queried'); } };
  const app = createApp({ database, corsOrigin: 'http://localhost:8080' });
  assert.equal((await request(app).get('/health')).status, 200);
  assert.equal((await request(app).get('/api/profile')).status, 401);
  assert.equal((await request(app).put('/api/profile/body').send({ heightCm: 168 })).status, 401);
});
