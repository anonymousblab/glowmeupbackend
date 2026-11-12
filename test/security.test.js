import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { buildSuitsMeData } from '../src/feature_data.js';
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

test('catalog recommendations use database product rows', () => {
  const catalog = buildSuitsMeData([
    {
      product_id: 'GM001',
      product_group: 'tops',
      product_name: 'Test Top',
      subcategory: 'button_shirt',
      primary_color: 'blue',
      color_family: 'blue',
      apparent_silhouette: 'relaxed',
      garment_length: 'hip',
      coverage_tags: ['shoulders_covered'],
      style_tags: ['minimalist'],
      occasion_tags: ['everyday'],
      formality: 'casual',
      visible_details: 'Blue test top',
      visual_confidence: 'high',
      review_status: 'needs_human_review',
      annotation_schema_version: 'working_v0.2',
    },
  ], { vibe: 'Minimal', color: 'Cool' });

  assert.equal(catalog.catalog.total, 1);
  assert.equal(catalog.recommendations[0].id, 'GM001');
  assert.equal(catalog.recommendations[0].match, 93);
  assert.equal(catalog.recommendations[0].imageUrl, '/dataset/images/GM001.jpg');
});
