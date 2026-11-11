# GlowMeUp Backend

Node.js + Express API for GlowMeUp. Authentication, sessions, consent, and profile data are handled by this API. Supabase is used only as PostgreSQL.

## Railway deployment

Set these Railway variables:

```text
DATABASE_URL=your_supabase_postgresql_connection_string
PG_SSL_REJECT_UNAUTHORIZED=false
CORS_ORIGIN=https://your-flutter-web-domain
PORT=3000
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini
AI_ENABLED=false
```

Supabase's pooled PostgreSQL connection can present a certificate chain that
Node does not trust inside Railway. Keep TLS enabled through `DATABASE_URL`, but
set `PG_SSL_REJECT_UNAUTHORIZED=false` for this deployment so the pool can
connect. Do not append Railway's internal port to the public API URL.

Deploy command:

```text
npm start
```

After the first deploy, apply the database schema locally with `npm run db:migrate`, or run the contents of `supabase/schema.sql` in the Supabase SQL Editor.

## Glowy chat

Authenticated clients can call `POST /api/ai/chat` with `{ "message": "..." }`. The API sends the message and the saved profile context to OpenAI's Responses API. Keep `OPENAI_API_KEY` only in Railway environment variables; never put it in Flutter or commit it to Git.

The AI route is intentionally disabled for the current preview. Set `AI_ENABLED=true` only when the OpenAI key is ready. LLM code is isolated under `src/ai/` so it can be enabled later without mixing it into feature routes.

## Feature data endpoints

The dummy data is intentionally separated by feature:

- `GET /api/know-me` - body, face, color, and style profile data
- `GET /api/suits-me` - match score and product recommendations
- `GET /api/connect` - community tabs and posts
- `GET /api/glowy` - Glowy prompts and suggestions

These are authenticated endpoints and currently return MVP seed data from separate backend contracts. They can later be replaced with Supabase queries per feature without changing the Flutter screen contracts.
