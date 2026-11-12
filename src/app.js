import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { connectData, glowyData, knowMeData, buildSuitsMeData } from './feature_data.js';
import { DomainError } from './ai/service.js';

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
const imageSchema = z.object({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  dataBase64: z.string().min(1),
}).strict();
const aiMessageSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  productId: z.string().regex(/^GM\d{3}$/).optional(),
  image: imageSchema.optional(),
  imageConsent: z.boolean().optional(),
}).strict();
const aiPhotoSchema = z.object({
  captureType: z.enum(['face', 'body']),
  consent: z.literal(true),
  image: imageSchema,
}).strict();
const aiConfirmSchema = z.object({
  proposalId: z.string().uuid(),
  acceptedFields: z.array(z.enum(['skinDepth', 'apparentShape'])).max(2),
}).strict();

export function createApp({
  database,
  corsOrigin,
  ai = null,
  aiRequestLimit = { maxCallsPerUserPerWindow: 20, windowMs: 3600000 },
}) {
  const app = express();
  app.disable('x-powered-by');
  // Railway terminates HTTPS in front of the app and forwards the client IP.
  // Trust exactly that first proxy so express-rate-limit can identify clients.
  app.set('trust proxy', 1);
  app.use(cors({ origin: corsOrigin.split(',').map((origin) => origin.trim()) }));
  // AI routes may carry a base64 photo; everything else stays small.
  app.use('/api/ai', express.json({ limit: '4mb' }));
  app.use(express.json({ limit: '16kb' }));
  app.use('/dataset', express.static(fileURLToPath(new URL('../public/dataset', import.meta.url)), {
    fallthrough: false,
    immutable: true,
    maxAge: '7d',
  }));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please try again later.' },
  });
  const aiUserLimiter = rateLimit({
    windowMs: aiRequestLimit.windowMs,
    limit: aiRequestLimit.maxCallsPerUserPerWindow,
    keyGenerator: (req) => req.userId,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: 'AI request limit reached. Please try again later.',
      code: 'AI_USER_RATE_LIMIT',
      retryable: true,
    },
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

  app.post('/api/ai/chat', aiUserLimiter, async (req, res, next) => {
    const parsed = aiMessageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid chat request.' });
    if (!ai) return res.status(503).json({ error: 'Glowy AI is temporarily disabled.' });
    try {
      const { rows } = await database.query(
        'select questionnaire from public.app_profiles where user_id = $1',
        [req.userId],
      );
      const { message, productId, image, imageConsent } = parsed.data;
      const result = await ai.chat({
        userId: req.userId,
        questionnaire: rows[0]?.questionnaire ?? null,
        message,
        productId: productId ?? null,
        image: image ? { mime_type: image.mimeType, data_base64: image.dataBase64 } : null,
        imageConsent: imageConsent === true,
      });
      res.json({
        reply: result.reply.reply,
        mode: result.reply.mode,
        referencedProductIds: result.reply.referenced_product_ids,
        uncertainties: result.reply.uncertainties,
        followUpQuestion: result.reply.follow_up_question,
        provider: result.provider,
      });
    } catch (error) { next(error); }
  });

  app.post('/api/ai/analyze-photo', aiUserLimiter, async (req, res, next) => {
    const parsed = aiPhotoSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid photo analysis request.' });
    if (!ai) return res.status(503).json({ error: 'Glowy AI is temporarily disabled.' });
    try {
      const result = await ai.analyzePhoto({
        userId: req.userId,
        captureType: parsed.data.captureType,
        consent: parsed.data.consent,
        image: { mime_type: parsed.data.image.mimeType, data_base64: parsed.data.image.dataBase64 },
      });
      res.json(result);
    } catch (error) { next(error); }
  });

  app.post('/api/ai/vision/confirm', async (req, res, next) => {
    const parsed = aiConfirmSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid confirmation request.' });
    if (!ai) return res.status(503).json({ error: 'Glowy AI is temporarily disabled.' });
    try {
      const accepted = ai.confirmVision({
        userId: req.userId,
        proposalId: parsed.data.proposalId,
        acceptedFields: parsed.data.acceptedFields,
      });
      await database.query(
        `update public.app_profiles
         set questionnaire = coalesce(questionnaire, '{}'::jsonb) || jsonb_build_object('vision', $1::jsonb),
             updated_at = now()
         where user_id = $2 and privacy_accepted_at is not null`,
        [JSON.stringify(accepted), req.userId],
      );
      res.json({ vision: accepted });
    } catch (error) { next(error); }
  });

  app.get('/api/ai/status', (_req, res) => {
    res.json(ai ? ai.diagnostics() : { mode: 'offline', selected_provider: 'disabled' });
  });

  // Separate read-only MVP contracts for each product feature.
  app.get('/api/know-me', (_req, res) => res.json({ feature: 'know-me', data: knowMeData }));
  app.get('/api/suits-me', async (req, res, next) => {
    try {
      const [profileResult, catalogResult] = await Promise.all([
        database.query(
          'select questionnaire from public.app_profiles where user_id = $1',
          [req.userId],
        ),
        database.query(`
          select product_id, product_group, subcategory, product_name,
                 primary_color, color_family, apparent_silhouette,
                 garment_length, coverage_tags, style_tags, occasion_tags,
                 formality, visible_details, visual_confidence, review_status,
                 annotation_schema_version
          from public.fashion_products
          where is_active = true
          order by product_id
        `),
      ]);
      res.json({
        feature: 'suits-me',
        data: buildSuitsMeData(
          catalogResult.rows,
          profileResult.rows[0]?.questionnaire ?? {},
        ),
      });
    } catch (error) { next(error); }
  });
  app.get('/api/connect', (_req, res) => res.json({ feature: 'connect', data: connectData }));
  app.get('/api/glowy', (_req, res) => {
    const aiEnabled = Boolean(ai?.enabled());
    res.json({ feature: 'glowy', data: { ...glowyData, aiEnabled }, aiEnabled });
  });

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
    if (error instanceof DomainError) {
      // Engine errors are already sanitized and carry user-facing messages.
      return res.status(error.status).json({ error: error.message, code: error.code, retryable: error.retryable });
    }
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
