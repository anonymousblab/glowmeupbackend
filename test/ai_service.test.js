import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { GlowyAiService, questionnaireToGlowProfile, loadCatalog } from '../src/ai/service.js';
import { rankProducts } from '../src/ai/engine/src/recommender.mjs';

const questionnaire = { heightCm: 165, explore: 'Mixed', vibe: 'Minimal', color: 'Neutral', look: 'A' };

test('questionnaire maps to a valid confirmed GlowProfile', () => {
  const profile = questionnaireToGlowProfile(questionnaire);
  assert.equal(profile.style_profile.primary, 'minimalist');
  assert.equal(profile.style_profile.confirmed, true);
  assert.deepEqual(profile.color_profile.liked_color_families, ['black', 'white', 'grey', 'beige']);
  assert.equal(questionnaireToGlowProfile(null), null);
});

test('bundled catalog passes engine validation and ranks', () => {
  const catalog = loadCatalog();
  assert.equal(catalog.length, 50);
  const ranked = rankProducts(questionnaireToGlowProfile(questionnaire), catalog, { limit: 50, demoOnly: true });
  assert.ok(ranked.length > 0);
  assert.match(ranked[0].product_id, /^GM\d{3}$/);
});

test('chat without a configured provider fails closed with a sanitized error', async () => {
  const ai = new GlowyAiService({ env: { AI_PROVIDER: 'disabled' } });
  assert.equal(ai.enabled(), false);
  await assert.rejects(
    ai.chat({ userId: 'user-1', questionnaire, message: 'halo' }),
    (error) => error.code === 'AI_NOT_CONFIGURED' && error.status === 503,
  );
});

test('ai routes require a session and report status', async () => {
  const database = { query: async () => ({ rows: [] }) };
  const ai = new GlowyAiService({ env: { AI_PROVIDER: 'disabled' } });
  const app = createApp({ database, corsOrigin: 'http://localhost:8080', ai });
  assert.equal((await request(app).post('/api/ai/chat').send({ message: 'hi' })).status, 401);
  assert.equal((await request(app).post('/api/ai/analyze-photo').send({})).status, 401);
  const glowy = await request(app).get('/api/glowy').set('Authorization', `Bearer ${'a'.repeat(64)}`);
  assert.equal(glowy.status, 401);
});

test('authenticated chat and photo routes retain their response contracts and share the user limit', async () => {
  const database = {
    query: async (sql) => {
      if (sql.includes('select user_id from public.app_sessions')) return { rows: [{ user_id: 'user-1' }] };
      if (sql.includes('select questionnaire from public.app_profiles')) return { rows: [{ questionnaire }] };
      return { rows: [] };
    },
  };
  const ai = {
    chat: async () => ({
      reply: {
        reply: 'Try a neutral outfit.',
        mode: 'ai',
        referenced_product_ids: [],
        uncertainties: [],
        follow_up_question: null,
      },
      provider: 'openai',
    }),
    analyzePhoto: async () => ({ proposalId: 'mock-proposal' }),
  };
  const app = createApp({
    database,
    corsOrigin: 'http://localhost:8080',
    ai,
    aiRequestLimit: { maxCallsPerUserPerWindow: 2, windowMs: 60000 },
  });
  const auth = { Authorization: `Bearer ${'a'.repeat(64)}` };

  const chat = await request(app).post('/api/ai/chat').set(auth).send({ message: 'What should I wear?' });
  assert.equal(chat.status, 200);
  assert.equal(chat.body.reply, 'Try a neutral outfit.');
  assert.equal(chat.body.provider, 'openai');

  const photo = await request(app).post('/api/ai/analyze-photo').set(auth).send({
    captureType: 'face',
    consent: true,
    image: { mimeType: 'image/jpeg', dataBase64: 'dGVzdA==' },
  });
  assert.equal(photo.status, 200);
  assert.deepEqual(photo.body, { proposalId: 'mock-proposal' });

  const limited = await request(app).post('/api/ai/chat').set(auth).send({ message: 'One more request' });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'AI_USER_RATE_LIMIT');
});
