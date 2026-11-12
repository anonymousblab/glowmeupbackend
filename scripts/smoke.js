import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { readConfig } from '../src/config.js';
import { createPool } from '../src/database.js';
import { createApp } from '../src/app.js';

const config = readConfig();
const database = createPool(config.databaseUrl);
const app = createApp({ database, corsOrigin: config.corsOrigin });
const email = `smoke-${randomUUID()}@example.test`;
const password = `test-${randomUUID()}`;

try {
  const signUp = await request(app).post('/api/auth/sign-up').send({ email, password });
  assert.equal(signUp.status, 201, JSON.stringify(signUp.body));
  const firstToken = signUp.body.token;
  assert.match(firstToken, /^[a-f0-9]{64}$/);

  const empty = await request(app).get('/api/profile').set('Authorization', `Bearer ${firstToken}`);
  assert.equal(empty.status, 200);
  assert.equal(empty.body.profile, null);

  const consent = await request(app).post('/api/consent')
    .set('Authorization', `Bearer ${firstToken}`).send({ accepted: true });
  assert.equal(consent.status, 204);

  const saved = await request(app).put('/api/profile/body')
    .set('Authorization', `Bearer ${firstToken}`).send({ heightCm: 168 });
  assert.equal(saved.status, 200);

  const questionnaire = { heightCm: 168, explore: 'Unisex', vibe: 'Minimal', color: 'Cool', look: 'B' };
  const quizSaved = await request(app).put('/api/profile/questionnaire')
    .set('Authorization', `Bearer ${firstToken}`).send(questionnaire);
  assert.equal(quizSaved.status, 200);

  const suitsMe = await request(app).get('/api/suits-me')
    .set('Authorization', `Bearer ${firstToken}`);
  assert.equal(suitsMe.status, 200, JSON.stringify(suitsMe.body));
  assert.equal(suitsMe.body.data.catalog.total, 50);
  assert.equal(suitsMe.body.data.recommendations.length, 50);
  assert.match(suitsMe.body.data.recommendations[0].imageUrl, /^\/dataset\/images\/GM\d{3}\.jpg$/);

  const signOut = await request(app).post('/api/auth/sign-out')
    .set('Authorization', `Bearer ${firstToken}`);
  assert.equal(signOut.status, 204);
  const rejected = await request(app).get('/api/profile')
    .set('Authorization', `Bearer ${firstToken}`);
  assert.equal(rejected.status, 401);

  const signIn = await request(app).post('/api/auth/sign-in').send({ email, password });
  assert.equal(signIn.status, 200);
  const profile = await request(app).get('/api/profile')
    .set('Authorization', `Bearer ${signIn.body.token}`);
  assert.equal(profile.body.profile.heightCm, 168);
  assert.deepEqual(profile.body.profile.questionnaire, questionnaire);
  console.log('Smoke test passed: account, profile, catalog recommendation, and session flow.');
} finally {
  await database.query('delete from public.app_users where email = $1', [email]);
  await database.end();
}
