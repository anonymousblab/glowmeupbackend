import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { connectData, glowyData, knowMeData, suitsMeData } from './feature_data.js';
import { createAiClient } from './ai/client.js';
import { generateGlowyReply } from './ai/glowy_service.js';

import { hashPassword, verifyPassword, newSessionToken, hashToken } from './security.js';

const credentialsSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(6).max(128),
}).strict();
const profileSchema = z.object({ heightCm: z.number().int().min(100).max(250) }).strict();
const questionnaireSchema = z.object({
  heightCm: z.number().int().min(100).max(250),
  explore: z.enum(['Menswear', 'Womenswear', 'Unisex', 'Modest Fashion', 'Mixed']),
  vibe: z.enum(['Casual', 'Minimal', 'Street', 'Formal', 'Chic', 'Other']),
  color: z.enum(['Cool', 'Warm', 'Neutral']),
  look: z.enum(['A', 'B', 'C', 'D']),
}).strict();
const consentSchema = z.object({ accepted: z.literal(true) }).strict();
const sessionDays = 7;
const aiMessageSchema = z.object({
  message: z.string().trim().min(1).max(2000),
}).strict();

export function createApp({ database, corsOrigin, openaiApiKey = '', openaiModel = 'gpt-4o-mini', aiEnabled = false }) {
  const app = express();
  // AI integration is intentionally disabled for the current MVP preview.
  // Enable it later with AI_ENABLED=true and OPENAI_API_KEY in Railway.
  const aiClient = createAiClient({ apiKey: openaiApiKey, enabled: aiEnabled });
  app.disable('x-powered-by');
  // Railway terminates HTTPS in front of the app and forwards the client IP.
  // Trust exactly that first proxy so express-rate-limit can identify clients.
  app.set('trust proxy', 1);
  app.use(cors({ origin: corsOrigin.split(',').map((origin) => origin.trim()) }));
  app.use(express.json({ limit: '16kb' }));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please try again later.' },
  });

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.post('/api/auth/sign-up', authLimiter, async (req, res, next) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Use a valid email and a password of at least 6 characters.' });
    const email = parsed.data.email.trim().toLowerCase();
    try {
      const userId = randomUUID();
      const passwordHash = await hashPassword(parsed.data.password);
      const token = newSessionToken();
      const { rows } = await database.query(
        `with created as (
           insert into public.app_users (id, email, password_hash)
           values ($1, $2, $3) on conflict (email) do nothing returning id
         )
         insert into public.app_sessions (token_hash, user_id, expires_at)
         select $4, id, $5 from created returning user_id`,
        [userId, email, passwordHash, hashToken(token), new Date(Date.now() + sessionDays * 86400000)],
      );
      if (rows.length === 0) return res.status(409).json({ error: 'Account already exists. Sign in instead.' });
      res.status(201).json({ token });
    } catch (error) { next(error); }
  });

  app.post('/api/auth/sign-in', authLimiter, async (req, res, next) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Use a valid email and password.' });
    try {
      const { rows } = await database.query(
        'select id, password_hash from public.app_users where email = $1',
        [parsed.data.email.trim().toLowerCase()],
      );
      const user = rows[0];
      if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
      const token = await saveSession(database, user.id);
      res.json({ token });
    } catch (error) { next(error); }
  });

  app.use('/api', async (req, res, next) => {
    const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    try {
      const { rows } = await database.query(
        'select user_id from public.app_sessions where token_hash = $1 and expires_at > now()',
        [hashToken(token)],
      );
      if (!rows[0]) return res.status(401).json({ error: 'Invalid or expired session' });
      req.userId = rows[0].user_id;
      req.tokenHash = hashToken(token);
      next();
    } catch (error) { next(error); }
  });

  app.post('/api/ai/chat', async (req, res, next) => {
    const parsed = aiMessageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Message must be between 1 and 2000 characters.' });
    if (!aiEnabled || !aiClient) return res.status(503).json({ error: 'Glowy AI is temporarily disabled.' });
    try {
      const { rows } = await database.query(
        'select height_cm, questionnaire from public.app_profiles where user_id = $1',
        [req.userId],
      );
      const profile = rows[0] ?? {};
      const reply = await generateGlowyReply({
        client: aiClient,
        model: openaiModel,
        profile,
        message: parsed.data.message,
      });
      res.json({ reply });
    } catch (error) { next(error); }
  });

  // Separate read-only MVP contracts for each product feature.
  app.get('/api/know-me', (_req, res) => res.json({ feature: 'know-me', data: knowMeData }));
  app.get('/api/suits-me', (_req, res) => res.json({ feature: 'suits-me', data: suitsMeData }));
  app.get('/api/connect', (_req, res) => res.json({ feature: 'connect', data: connectData }));
  app.get('/api/glowy', (_req, res) => res.json({ feature: 'glowy', data: glowyData, aiEnabled }));

  app.post('/api/auth/sign-out', async (req, res, next) => {
    try {
      await database.query('delete from public.app_sessions where token_hash = $1', [req.tokenHash]);
      res.status(204).end();
    } catch (error) { next(error); }
  });

  app.get('/api/profile', async (req, res, next) => {
    try {
      const { rows } = await database.query(
        'select height_cm, questionnaire, privacy_accepted_at, updated_at from public.app_profiles where user_id = $1',
        [req.userId],
      );
      const data = rows[0];
      res.json({ profile: data ? {
        heightCm: data.height_cm,
        questionnaire: data.questionnaire,
        privacyAcceptedAt: data.privacy_accepted_at,
        updatedAt: data.updated_at,
      } : null });
    } catch (error) { next(error); }
  });

  app.post('/api/consent', async (req, res, next) => {
    const parsed = consentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Consent must be accepted' });
    try {
      await database.query(
        `insert into public.app_profiles (user_id, privacy_accepted_at)
         values ($1, now())
         on conflict (user_id) do update set privacy_accepted_at = excluded.privacy_accepted_at`,
        [req.userId],
      );
      res.status(204).end();
    } catch (error) { next(error); }
  });

  app.put('/api/profile/body', async (req, res, next) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Height must be between 100 and 250 cm' });
    try {
      const result = await database.query(
        `update public.app_profiles set height_cm = $1, updated_at = now()
         where user_id = $2 and privacy_accepted_at is not null`,
        [parsed.data.heightCm, req.userId],
      );
      if (result.rowCount === 0) return res.status(403).json({ error: 'Privacy consent required' });
      res.json({ heightCm: parsed.data.heightCm });
    } catch (error) { next(error); }
  });

  app.put('/api/profile/questionnaire', async (req, res, next) => {
    const parsed = questionnaireSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Complete the profile questions before continuing.' });
    try {
      const result = await database.query(
        `update public.app_profiles set height_cm = $1, questionnaire = $2::jsonb, updated_at = now()
         where user_id = $3 and privacy_accepted_at is not null`,
        [parsed.data.heightCm, JSON.stringify(parsed.data), req.userId],
      );
      if (result.rowCount === 0) return res.status(403).json({ error: 'Privacy consent required' });
      res.json({ questionnaire: parsed.data });
    } catch (error) { next(error); }
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

async function saveSession(database, userId) {
  const token = newSessionToken();
  await database.query(
    'insert into public.app_sessions (token_hash, user_id, expires_at) values ($1, $2, $3)',
    [hashToken(token), userId, new Date(Date.now() + sessionDays * 86400000)],
  );
  return token;
}
