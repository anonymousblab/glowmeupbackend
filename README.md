# GlowMeUp API

Node.js and Express backend for the GlowMeUp mobile application. It provides account registration, session management, profile storage, consent handling, feature data, and the Glowy chat endpoint. Supabase is used as managed PostgreSQL storage.

## Requirements

- Node.js 20 or newer
- PostgreSQL database or Supabase project
- Railway or another Node.js hosting provider for production

Install dependencies:

```bash
npm install
```

## Environment configuration

The delivery package includes a configured `.env` so the current environment can be started immediately. Use `.env.example` when creating another environment, and rotate the supplied credentials when project ownership is transferred.

```text
PORT=3000
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/postgres
CORS_ORIGIN=http://localhost:3000
PG_SSL_REJECT_UNAUTHORIZED=false
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
AI_ENABLED=false
```

Use the Supabase Session Pooler connection string for Railway. Keep TLS enabled in `DATABASE_URL`; `PG_SSL_REJECT_UNAUTHORIZED=false` is required when the hosted pooler presents a certificate chain that Node does not trust inside Railway.

## Database setup

Apply the schema with either method:

```bash
npm run db:migrate
npm run db:seed
```

Or run `supabase/schema.sql` in the Supabase SQL Editor.

The schema creates:

- `public.app_users` for registered accounts
- `public.app_sessions` for hashed session tokens
- `public.app_profiles` for consent, measurements, and questionnaire results

This project uses its own backend authentication. Accounts therefore appear in `public.app_users`, not under Supabase Authentication.

## Local development

```bash
npm run dev
```

Health check:

```text
GET http://localhost:3000/health
```

## Railway deployment

Set the environment variables listed above in Railway. Railway terminates HTTPS before forwarding traffic to Express, and the application is configured to trust the first proxy hop for accurate rate limiting.

Start command:

```bash
npm start
```

Current public API:

```text
https://glowmeupbackend-production.up.railway.app
```

The Railway internal port does not need to be appended to the public URL.

## Main endpoints

```text
POST /api/auth/sign-up
POST /api/auth/sign-in
POST /api/auth/sign-out
GET  /api/profile
POST /api/consent
PUT  /api/profile/body
PUT  /api/profile/questionnaire
GET  /api/know-me
GET  /api/suits-me
GET  /dataset/images/:productId.jpg
GET  /api/connect
GET  /api/glowy
POST /api/ai/chat
```

Protected endpoints require an `Authorization: Bearer <token>` header.

## Fashion catalog

`GET /api/suits-me` reads active rows from `public.fashion_products` and ranks them against the saved questionnaire. The Flutter app uses the returned product title, labels, match explanation, and image URL on the Suits Me, product detail, and GlowMatch screens.

The source catalog is stored at `src/data/fashion_dataset.json` and imported with `npm run db:seed`. The seed is idempotent, so rerunning it updates existing products without creating duplicates. Product images are served from `public/dataset/images`. Current labels are a first-pass review and the source images are 200×200 thumbnails. Before a public commercial release, verify image rights, replace low-resolution or ambiguous images, and complete human label review. Price, stock, material, sizing, and guaranteed fit are intentionally not supplied.

## Tests

```bash
npm test
npm run smoke
```

The smoke test creates a temporary account, exercises the profile and session flow, and removes the account when complete.

## Production notes

- Store database credentials and API keys only in hosting environment variables.
- Set `CORS_ORIGIN` to the deployed web client origin when Flutter web is used.
- Keep `AI_ENABLED=false` until an OpenAI key and usage policy are ready.
- Review rate limits and session duration before a public launch.
