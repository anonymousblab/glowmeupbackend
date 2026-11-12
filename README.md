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

For local development, create `.env` from `.env.example` and enter credentials locally; `.env` is ignored by Git. For Railway, configure secrets and settings in the service's Variables panel instead of committing an `.env` file.

```text
PORT=3000
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/postgres
CORS_ORIGIN=http://localhost:3000
PG_SSL_REJECT_UNAUTHORIZED=false
AI_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_CHAT_MODEL=gpt-6-luna
OPENAI_VISION_MODEL=gpt-6.1-terra
OPENAI_KEY_ROTATED_CONFIRMED=false
OPENAI_ENABLE_LIVE=false
OPENAI_BUDGET_USD=0.50
OPENAI_MAX_CALLS_PER_WINDOW=20
OPENAI_CALL_WINDOW_MS=3600000
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
- Keep `OPENAI_ENABLE_LIVE=false` and `OPENAI_KEY_ROTATED_CONFIRMED=false` until a rotated OpenAI key and usage policy are ready. Set both to `true` in the hosting environment only after verification.
- For live OpenAI, verify `AI_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL=gpt-6-luna`, `OPENAI_VISION_MODEL=gpt-6.1-terra`, and both enable/rotation flags above. Missing optional AI values leave Glowy offline; they do not prevent the Express API from starting.
- `OPENAI_BUDGET_USD` accepts any finite positive amount. It is an estimated, cumulative in-memory budget per Node.js process—not an OpenAI billing cap—and resets on process restart. Multiple Railway replicas each maintain separate counters. Use OpenAI project spending limits for account-level protection; a persistent cross-replica ledger requires shared storage and atomic reservations.
- `OPENAI_MAX_CALLS_PER_WINDOW` and `OPENAI_CALL_WINDOW_MS` limit request volume independently of spending. The previous `OPENAI_MAX_CALLS_PER_RUN` name remains accepted for existing deployments.
- OpenAI cost estimates use Standard uncached pricing: GPT-6 Luna ($0.10 / $0.50) for chat and GPT-6.1 Terra ($1.00 / $5.00) for image input, per million input/output tokens. Image usage is conservatively estimated; actual billing is controlled by OpenAI.
- GPT-4.1 mini remains supported as an explicit model option, but OpenAI marks it deprecated; the default is now GPT-6 Luna/Terra.
- Review rate limits and session duration before a public launch.
